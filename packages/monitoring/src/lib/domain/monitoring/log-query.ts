import { isRecord } from '@/lib/domain/is-record.ts'

/**
 * One log line as VictoriaLogs returns it from `/select/logsql/query`:
 * the streaming endpoint emits newline-delimited JSON objects, each
 * carrying at least `_time` and `_msg` plus whatever stream fields the
 * ingest preserved (`nn_project`, `container_name`, …).
 */
export interface LogLine {
	readonly time: string
	readonly message: string
	readonly container: string | null
}

const LOGSQL_QUERY_LIMIT = 200

/**
 * Build a LogsQL query for the most recent lines of one VPS over a
 * window. The `nn_project` stream is not used here because machine-level
 * views key on `vps_name`, which Vector stamps via the relabel - but the
 * container view filters by `nn_project`. Both selectors are exposed as
 * dedicated builders so the call site reads declaratively.
 */
export const buildProjectLogsQuery = (project: string): string =>
	`nn_project:${JSON.stringify(project)} | sort by (_time desc) | limit ${String(LOGSQL_QUERY_LIMIT)}`

/**
 * Parse the newline-delimited JSON VictoriaLogs streams back. Tolerant:
 * blank lines and unparseable fragments are skipped (a partial last line
 * on a truncated stream must not abort the whole panel).
 */
export const parseLogLines = (body: string): ReadonlyArray<LogLine> => {
	const lines: Array<LogLine> = []
	for (const raw of body.split('\n')) {
		const trimmed = raw.trim()
		if (trimmed.length === 0) continue
		const parsed = safeParse(trimmed)
		if (parsed === null) continue
		lines.push(parsed)
	}
	return lines
}

const safeParse = (raw: string): LogLine | null => {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (!isRecord(parsed)) return null
	// `_time` / `_msg` are VictoriaLogs' built-in field names; bracket
	// access keeps the underscore-prefixed external contract out of dot
	// notation.
	const timeField = parsed['_time']
	const msgField = parsed['_msg']
	const time = typeof timeField === 'string' ? timeField : null
	const message = typeof msgField === 'string' ? msgField : null
	if (time === null || message === null) return null
	const container =
		typeof parsed.container_name === 'string' ? parsed.container_name : null
	return { time, message, container }
}
