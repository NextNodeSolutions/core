import {
	escapeHtml,
	extractFatalMessage,
	parseInvocations,
	renderExceptionLine,
	renderHeaderLine,
	renderLogLine,
} from '@/components/cloudflare/deployment-tail.render.ts'

/**
 * Pure stream helpers for the React build-log tail: status/line types, the
 * capped line-append reducer, the invocation→HTML rendering, and the
 * EventSource event wiring. Kept out of the hook so the hook is just state +
 * the teardown effect. The HTML rendering reuses `deployment-tail.render.ts`
 * verbatim so the React drawer and the server panel format frames identically.
 */

const MAX_LINES = 1000

export type TailStatus = 'idle' | 'connecting' | 'live' | 'stopped' | 'error'

export interface TailLine {
	readonly id: number
	readonly html: string
}

export interface TailLineState {
	readonly lines: ReadonlyArray<TailLine>
	readonly nextId: number
}

/**
 * Append rendered HTML lines to the retained scrollback, assigning each a
 * monotonic id from `nextId` and enforcing the hard `MAX_LINES` cap - a chatty
 * Functions invocation can stream for hours, so unbounded retention would
 * eventually OOM the tab. Pure: returns the new lines + the next id, never
 * mutates its inputs.
 */
export const appendTailLines = (
	state: TailLineState,
	htmlLines: ReadonlyArray<string>,
): TailLineState => {
	if (!htmlLines.length) return state
	const appended = htmlLines.map((html, offset) => ({
		id: state.nextId + offset,
		html,
	}))
	const merged = [...state.lines, ...appended]
	return {
		lines:
			merged.length > MAX_LINES
				? merged.slice(merged.length - MAX_LINES)
				: merged,
		nextId: state.nextId + htmlLines.length,
	}
}

const readMessageData = (event: MessageEvent): string =>
	typeof event.data === 'string' ? event.data : ''

const renderInvocations = (raw: string): ReadonlyArray<string> => {
	const invocations = parseInvocations(raw)
	if (!invocations?.length) {
		return [
			`<span class="text-red-400">! malformed tail frame: ${escapeHtml(raw)}</span>`,
		]
	}
	const lines: string[] = []
	for (const invocation of invocations) {
		lines.push(renderHeaderLine(invocation))
		for (const log of invocation.logs ?? []) lines.push(renderLogLine(log))
		for (const exception of invocation.exceptions ?? [])
			lines.push(renderExceptionLine(exception))
	}
	return lines
}

export interface TailSink {
	readonly append: (htmlLines: ReadonlyArray<string>) => void
	readonly setStatus: (status: TailStatus) => void
	readonly stop: () => void
}

/**
 * Open the tail EventSource and wire its `session` / `invocation` / `fatal` /
 * `error` events to the sink. Returns the open source so the hook can hold a
 * ref to it for teardown. The fatal / transport-error handlers append a red
 * line, flip the status, then stop - matching the former client behaviour.
 */
export const bindTailSource = (
	streamUrl: string,
	sink: TailSink,
): EventSource => {
	sink.append(['<span class="text-base-400">Opening tail session…</span>'])
	const source = new EventSource(streamUrl)

	source.addEventListener('session', () => {
		sink.setStatus('live')
		sink.append([
			'<span class="text-accent-300">Tail session open - waiting for invocations.</span>',
		])
	})
	source.addEventListener('invocation', event => {
		if (event instanceof MessageEvent) {
			sink.append(renderInvocations(readMessageData(event)))
		}
	})
	source.addEventListener('fatal', event => {
		const raw = event instanceof MessageEvent ? readMessageData(event) : ''
		sink.append([
			`<span class="text-red-400">! ${escapeHtml(extractFatalMessage(raw))}</span>`,
		])
		sink.setStatus('error')
		sink.stop()
	})
	source.addEventListener('error', () => {
		sink.append(['<span class="text-red-400">! connection lost</span>'])
		sink.setStatus('error')
		sink.stop()
	})

	return source
}
