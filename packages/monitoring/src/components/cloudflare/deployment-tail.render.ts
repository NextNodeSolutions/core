import { isRecord } from '@/lib/domain/is-record.ts'

export interface InvocationLog {
	readonly level?: string
	readonly message?: unknown
}

export interface InvocationException {
	readonly name?: string
	readonly message?: string
}

export interface Invocation {
	readonly outcome?: string
	readonly eventTimestamp?: number
	readonly logs?: ReadonlyArray<InvocationLog>
	readonly exceptions?: ReadonlyArray<InvocationException>
	readonly event?: {
		readonly request?: { readonly method?: string; readonly url?: string }
	}
}

const CLOCK_START = 11
const CLOCK_END = 19

const OUTCOME_COLORS: Record<string, string> = {
	ok: 'text-accent-300',
	exception: 'text-red-400',
	exceededCpu: 'text-amber-300',
	canceled: 'text-base-400',
}

const LEVEL_COLORS: Record<string, string> = {
	error: 'text-red-400',
	warn: 'text-amber-300',
}

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
}

const readString = (raw: unknown): string | undefined =>
	typeof raw === 'string' ? raw : undefined

const readNumber = (raw: unknown): number | undefined =>
	typeof raw === 'number' ? raw : undefined

const readArray = (raw: unknown): ReadonlyArray<unknown> =>
	Array.isArray(raw) ? raw : []

const toInvocation = (entry: Record<string, unknown>): Invocation => {
	const tailEvent = isRecord(entry.event) ? entry.event : undefined
	const request =
		tailEvent && isRecord(tailEvent.request) ? tailEvent.request : undefined
	return {
		outcome: readString(entry.outcome),
		eventTimestamp: readNumber(entry.eventTimestamp),
		logs: readArray(entry.logs).filter(isRecord),
		exceptions: readArray(entry.exceptions).filter(isRecord),
		event: request
			? {
					request: {
						method: readString(request.method),
						url: readString(request.url),
					},
				}
			: undefined,
	}
}

// Cloudflare wraps tail events in an array per frame (documented example:
// `[{ outcome, eventTimestamp, logs, … }]`); singleton object frames have
// been observed too, so we accept both shapes.
export const parseInvocations = (
	raw: string,
): ReadonlyArray<Invocation> | null => {
	try {
		const parsed: unknown = JSON.parse(raw)
		if (Array.isArray(parsed))
			return parsed.filter(isRecord).map(toInvocation)
		if (isRecord(parsed)) return [toInvocation(parsed)]
		return null
	} catch {
		return null
	}
}

export const escapeHtml = (text: string): string =>
	text.replace(/[&<>"']/g, char => HTML_ESCAPES[char] ?? char)

const formatLogMessage = (message: unknown): string => {
	if (Array.isArray(message)) {
		return message.map(part => formatLogMessage(part)).join(' ')
	}
	if (typeof message === 'string') return message
	try {
		return JSON.stringify(message)
	} catch {
		return String(message)
	}
}

const toClockTime = (ms: number | undefined): string => {
	if (!ms || !Number.isFinite(ms)) return '--:--:--'
	return new Date(ms).toISOString().slice(CLOCK_START, CLOCK_END)
}

export const renderHeaderLine = (invocation: Invocation): string => {
	const outcome = invocation.outcome ?? 'unknown'
	const color = OUTCOME_COLORS[outcome] ?? 'text-base-400'
	const time = toClockTime(invocation.eventTimestamp)
	const method = invocation.event?.request?.method
	const url = invocation.event?.request?.url
	const req = method && url ? `${method} ${url}` : ''
	return (
		`<span class="text-base-400">${time}</span> ` +
		`<span class="${color}">${escapeHtml(outcome)}</span> ` +
		`<span class="text-base-200">${escapeHtml(req)}</span>`
	)
}

export const renderLogLine = (log: InvocationLog): string => {
	const level = log.level ?? 'log'
	const color = LEVEL_COLORS[level] ?? 'text-base-200'
	const message = escapeHtml(formatLogMessage(log.message))
	return (
		`  <span class="${color}">[${escapeHtml(level)}]</span> ` +
		`<span class="text-base-100">${message}</span>`
	)
}

export const renderExceptionLine = (exception: InvocationException): string =>
	`  <span class="text-red-400">[${escapeHtml(exception.name ?? 'Error')}] ${escapeHtml(exception.message ?? '')}</span>`

export const extractFatalMessage = (raw: string): string => {
	if (!raw) return 'connection lost'
	try {
		const parsed: unknown = JSON.parse(raw)
		if (isRecord(parsed) && typeof parsed.message === 'string') {
			return parsed.message
		}
	} catch {
		/* fall through */
	}
	return raw
}
