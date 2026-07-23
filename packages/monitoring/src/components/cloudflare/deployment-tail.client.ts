import {
	extractFatalMessage,
	escapeHtml,
	parseInvocations,
	renderExceptionLine,
	renderHeaderLine,
	renderLogLine,
} from '@/components/cloudflare/deployment-tail.render.ts'

const TONE_CLASSES = {
	idle: 'bg-base-300',
	live: 'bg-accent-500 animate-pulse',
	error: 'bg-red-500',
} satisfies Record<string, string>

type Tone = keyof typeof TONE_CLASSES

// Hard cap on retained scrollback. A chatty Functions invocation can stream
// for hours; without this the DOM grows until the tab OOMs.
const MAX_LINES = 1000

interface TailOutput {
	readonly reset: (initialHtml: string) => void
	readonly appendLine: (html: string) => void
	readonly appendLines: (lines: ReadonlyArray<string>) => void
}

const createTailOutput = (outputEl: HTMLElement): TailOutput => {
	const el = outputEl
	let lineCount = 0
	const enforceCap = (): void => {
		while (lineCount > MAX_LINES && el.firstChild) {
			el.removeChild(el.firstChild)
			lineCount--
		}
	}
	const appendLines = (lines: ReadonlyArray<string>): void => {
		if (!lines.length) return
		const fragment = document.createDocumentFragment()
		for (const html of lines) {
			const div = document.createElement('div')
			div.innerHTML = html
			fragment.appendChild(div)
		}
		el.appendChild(fragment)
		lineCount += lines.length
		enforceCap()
		el.scrollTop = el.scrollHeight
	}
	return {
		reset: (initialHtml: string): void => {
			el.innerHTML = initialHtml
			lineCount = 0
		},
		appendLine: (html: string): void => appendLines([html]),
		appendLines,
	}
}

const readMessageData = (event: Event): string => {
	if (event instanceof MessageEvent && typeof event.data === 'string') {
		return event.data
	}
	return ''
}

const renderInvocation = (sink: TailOutput, raw: string): void => {
	const invocations = parseInvocations(raw)
	if (!invocations?.length) {
		sink.appendLine(
			`<span class="text-red-400">! malformed tail frame: ${escapeHtml(raw)}</span>`,
		)
		return
	}
	const lines: string[] = []
	for (const invocation of invocations) {
		lines.push(renderHeaderLine(invocation))
		for (const log of invocation.logs ?? []) lines.push(renderLogLine(log))
		for (const exception of invocation.exceptions ?? [])
			lines.push(renderExceptionLine(exception))
	}
	sink.appendLines(lines)
}

interface TailControls {
	readonly dot: HTMLElement
	readonly labelEl: HTMLElement
	readonly startBtn: HTMLButtonElement
	readonly stopBtn: HTMLButtonElement
	readonly clearBtn: HTMLButtonElement
}

const resolveControls = (root: HTMLElement): TailControls | null => {
	const labelEl = root.querySelector<HTMLElement>('[data-tail-label]')
	const dot = root.querySelector<HTMLElement>('[data-tail-dot]')
	const startBtn = root.querySelector<HTMLButtonElement>('[data-tail-start]')
	const stopBtn = root.querySelector<HTMLButtonElement>('[data-tail-stop]')
	const clearBtn = root.querySelector<HTMLButtonElement>('[data-tail-clear]')
	if (!labelEl || !dot || !startBtn || !stopBtn || !clearBtn) return null
	return { dot, labelEl, startBtn, stopBtn, clearBtn }
}

interface SessionHandle {
	readonly start: () => void
	readonly stop: () => void
}

const createSession = (
	streamUrl: string,
	sink: TailOutput,
	setStatus: (label: string, tone: Tone) => void,
): SessionHandle => {
	let source: EventSource | null = null

	const stop = (): void => {
		if (!source) return
		source.close()
		source = null
		setStatus('Stopped', 'idle')
	}

	const handleFatal = (event: Event): void => {
		const message = extractFatalMessage(readMessageData(event))
		sink.appendLine(
			`<span class="text-red-400">! ${escapeHtml(message)}</span>`,
		)
		setStatus('Error', 'error')
		stop()
	}

	const handleTransportError = (): void => {
		if (!source) return
		sink.appendLine('<span class="text-red-400">! connection lost</span>')
		setStatus('Error', 'error')
		stop()
	}

	const start = (): void => {
		if (source) return
		sink.reset('')
		sink.appendLine(
			'<span class="text-base-400">Opening tail session…</span>',
		)
		setStatus('Connecting…', 'idle')
		source = new EventSource(streamUrl)
		source.addEventListener('session', () => {
			setStatus('Live', 'live')
			sink.appendLine(
				'<span class="text-accent-300">Tail session open - waiting for invocations.</span>',
			)
		})
		source.addEventListener('invocation', event => {
			renderInvocation(sink, readMessageData(event))
		})
		source.addEventListener('fatal', handleFatal)
		source.addEventListener('error', handleTransportError)
	}

	return { start, stop }
}

// Active sessions for every bound panel on the current document. With View
// Transitions a soft navigation swaps the DOM without a `beforeunload`, so we
// close every open EventSource on `astro:before-swap` to avoid leaking SSE
// connections across page swaps.
const activeSessions = new Set<SessionHandle>()

const bindTailPanel = (root: HTMLElement): void => {
	// `astro:page-load` re-binds on every soft navigation; this guard keeps the
	// binding idempotent so a re-rendered (but identically-marked) panel is not
	// wired twice.
	const el = root
	if (el.dataset.tailBound === 'true') return
	const { streamUrl } = el.dataset
	if (!streamUrl) return
	const output = el.querySelector<HTMLElement>('[data-tail-output]')
	const controls = resolveControls(el)
	if (!output || !controls) return
	el.dataset.tailBound = 'true'

	const sink = createTailOutput(output)
	const setStatus = (label: string, tone: Tone): void => {
		controls.dot.className = `inline-block size-1.5 rounded-full ${TONE_CLASSES[tone]}`
		controls.labelEl.textContent = label
	}

	const session = createSession(streamUrl, sink, setStatus)
	activeSessions.add(session)

	controls.startBtn.addEventListener('click', session.start)
	controls.stopBtn.addEventListener('click', session.stop)
	controls.clearBtn.addEventListener('click', () => {
		sink.reset(
			'<span class="text-base-400">Cleared. Press “Start tail” to resume.</span>',
		)
	})
	window.addEventListener('beforeunload', session.stop)
}

const bindAllTailPanels = (): void => {
	for (const root of document.querySelectorAll<HTMLElement>(
		'[data-tail-root]',
	)) {
		bindTailPanel(root)
	}
}

const closeAllSessions = (): void => {
	for (const session of activeSessions) session.stop()
	activeSessions.clear()
}

// Fires on the initial page load AND after every View-Transitions soft swap.
document.addEventListener('astro:page-load', bindAllTailPanels)
// Tear down open streams before the DOM is swapped out from under us.
document.addEventListener('astro:before-swap', closeAllSessions)
