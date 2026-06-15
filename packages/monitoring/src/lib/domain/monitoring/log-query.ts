import { isRecord } from '@/lib/domain/is-record.ts'

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/**
 * One log line as VictoriaLogs returns it from `/select/logsql/query`:
 * the streaming endpoint emits newline-delimited JSON objects, each
 * carrying at least `_time` and `_msg` plus whatever stream fields the
 * ingest preserved (`nn_project`, `container_name`, `level`, `nn_service`…).
 * `level` and `service` are read straight from the structured fields when
 * present and left null otherwise - never inferred from the message text.
 */
export interface LogLine {
	readonly time: string
	readonly message: string
	readonly container: string | null
	readonly level: LogLevel | null
	readonly service: string | null
}

const LOGSQL_QUERY_LIMIT = 200

// Bound the container-name scan (container_name is a regular field, not a
// stream field, so an unbounded scan would read the whole retention).
const CONTAINER_SCAN_WINDOW = '6h'

// Fleet-wide log stream window for the overview screen.
const FLEET_LOG_WINDOW = '6h'

// Normalise the many level/severity spellings emitters use down to the four
// levels the UI renders. Anything unrecognised stays null (not "info").
const LEVEL_ALIASES: Readonly<Record<string, LogLevel>> = {
	trace: 'debug',
	debug: 'debug',
	info: 'info',
	information: 'info',
	notice: 'info',
	warn: 'warn',
	warning: 'warn',
	error: 'error',
	err: 'error',
	fatal: 'error',
	critical: 'error',
	crit: 'error',
}

export const parseLogLevel = (candidate: unknown): LogLevel | null => {
	if (typeof candidate !== 'string') return null
	return LEVEL_ALIASES[candidate.trim().toLowerCase()] ?? null
}

/**
 * Build a LogsQL query for the most recent lines of one VPS. `nn_project`
 * is the VPS-level stream field Vector stamps (= the host hostname), so
 * this returns EVERY line on the VPS - container logs + journald
 * (Caddy/sshd/kernel) - which is exactly the VPS view's scope. Indexed by
 * the stream field, so no time bound is needed for correctness.
 */
export const buildVpsLogsQuery = (vpsName: string): string =>
	`nn_project:${JSON.stringify(vpsName)} | sort by (_time desc) | limit ${String(LOGSQL_QUERY_LIMIT)}`

/**
 * Build a LogsQL query for the most recent lines of one PROJECT, across
 * whichever VPS hosts it. Because `nn_project` is host-level, per-project
 * disambiguation is by `container_name`, which compose names
 * `<project>-<env>-<service>-N`; the `<project>-` prefix isolates the
 * project's containers (journald/host lines, which have no
 * container_name, are correctly excluded). Bounded by a time window since
 * container_name is not a stream field.
 */
export const buildContainerLogsQuery = (project: string): string =>
	`_time:${CONTAINER_SCAN_WINDOW} container_name:~${JSON.stringify(`^${escapeRegex(project)}-`)} | sort by (_time desc) | limit ${String(LOGSQL_QUERY_LIMIT)}`

/**
 * Build a LogsQL query for the most recent lines across the WHOLE fleet
 * (every VPS, every container + journald), newest first. Used by the
 * overview log stream and its error tally. Time-bounded since there is no
 * stream filter to ride.
 */
export const buildFleetLogsQuery = (): string =>
	`_time:${FLEET_LOG_WINDOW} | sort by (_time desc) | limit ${String(LOGSQL_QUERY_LIMIT)}`

// Escape the project slug for safe embedding in a LogsQL regex. Project
// names are kebab identifiers (no regex metachars today), but a deploy
// could in principle carry one - escape defensively.
const escapeRegex = (slug: string): string =>
	slug.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

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
	const level = parseLogLevel(parsed.level ?? parsed.severity)
	const serviceField = parsed['nn_service'] ?? parsed.service
	const service = typeof serviceField === 'string' ? serviceField : null
	return { time, message, container, level, service }
}
