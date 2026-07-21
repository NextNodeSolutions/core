import { escapeRegex } from '@/lib/domain/escape-regex.ts'
import { isRecord } from '@/lib/domain/is-record.ts'
import { logsqlQuoted } from '@/lib/domain/monitoring/logsql.ts'
import { windowToLogsQL } from '@/lib/domain/monitoring/vps-metrics.ts'
import { parseFiniteNumber } from '@/lib/domain/parse-number.ts'
import { parseStringOrNull } from '@/lib/domain/parse-string.ts'

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
	readonly vps: string | null
	readonly status: number | null
	readonly method: string | null
	readonly path: string | null
	readonly durationMs: number | null
	readonly traceId: string | null
	readonly stack: string | null
	readonly meta: Readonly<Record<string, string>>
}

const LOGSQL_QUERY_LIMIT = 200

// Bound the container-name scan (container_name is a regular field, not a
// stream field, so an unbounded scan would read the whole retention).
const CONTAINER_SCAN_WINDOW = '6h'

// @nextnode-solutions/logger and Caddy emit each line as a JSON object;
// Vector's docker_logs/journald source captures that whole line into
// `_msg` (the sink maps `message -> _msg`), so the structured fields
// (`level`, `message`, `status`, `method`, …) stay TRAPPED inside the
// `_msg` string instead of being queryable top-level fields. `unpack_json`
// lifts those fields to the top level so `safeParse` can read them; it
// defaults to the `_msg` field and leaves `_msg` itself in place (verified
// against the VictoriaLogs LogsQL docs and the in-repo precedent in
// packages/infrastructure alert-rules-self.ts / this package's
// caddy-stats.ts). Placed after `limit` so the unpack only runs over the
// 200 returned lines, not the whole scanned stream. Plain (non-JSON)
// journald lines are left untouched - `safeParse` then falls back to `_msg`.
const UNPACK_PIPE = '| unpack_json'

// Default fleet-wide log stream window (hours) when a caller does not pick one.
const DEFAULT_FLEET_LOG_HOURS = 6

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

// The raw level/severity spellings that normalise to `error` (the subset of
// LEVEL_ALIASES mapping to 'error'), as a case-insensitive anchored LogsQL
// regex. Kept next to LEVEL_ALIASES so the server-side error tally and the
// client-side level parsing can never drift apart.
const ERROR_LEVEL_PATTERN = '(?i)^(error|err|fatal|critical|crit)$'

/**
 * Build a LogsQL query for the most recent lines of one VPS. `nn_project`
 * is the VPS-level stream field Vector stamps (= the host hostname), so
 * this returns EVERY line on the VPS - container logs + journald
 * (Caddy/sshd/kernel) - which is exactly the VPS view's scope. Indexed by
 * the stream field, so no time bound is needed for correctness.
 */
export const buildVpsLogsQuery = (vpsName: string): string =>
	`nn_project:${logsqlQuoted(vpsName)} | sort by (_time desc) | limit ${String(LOGSQL_QUERY_LIMIT)} ${UNPACK_PIPE}`

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
	`_time:${CONTAINER_SCAN_WINDOW} container_name:~${logsqlQuoted(`^${escapeRegex(project)}-`)} | sort by (_time desc) | limit ${String(LOGSQL_QUERY_LIMIT)} ${UNPACK_PIPE}`

/**
 * The /logs server-side filters that scope BOTH the line sample and the
 * windowed stats, so the histogram / counts / list all reflect the operator's
 * facet + search choices (no client-side facet drift). `vps` rides as a stream
 * filter before unpack (cheap); `service`/`query` filter the unpacked fields.
 * The LEVEL filter is intentionally NOT here - it stays a client-side list
 * refinement so the histogram keeps showing the full level distribution.
 */
export interface FleetLogFilter {
	readonly service?: string
	readonly vps?: string
	readonly query?: string
}

/** Distinct facet values over the window, for the /logs filter dropdowns. */
export interface LogFacets {
	readonly services: ReadonlyArray<string>
	readonly vps: ReadonlyArray<string>
}

export const hasFleetLogFilter = (filter: FleetLogFilter): boolean =>
	Boolean(filter.vps ?? '') ||
	Boolean(filter.service ?? '') ||
	Boolean(filter.query ?? '')

/** Stream-field scope appended to the `_time:` head (rides BEFORE unpack). */
export const streamScope = (filter: FleetLogFilter): string =>
	filter.vps ? ` nn_project:${logsqlQuoted(filter.vps)}` : ''

/**
 * Post-unpack `| filter` clauses for fields inside the unpacked JSON
 * (`nn_service`) and a case-insensitive substring search over the raw line
 * (`_msg`, which still holds the whole record so message/path/etc. match).
 * Empty string when neither is set. Validated against a live VictoriaLogs.
 */
export const unpackedScope = (filter: FleetLogFilter): string => {
	const clauses: Array<string> = []
	if (filter.service)
		clauses.push(`nn_service:${logsqlQuoted(filter.service)}`)
	if (filter.query) {
		clauses.push(
			`_msg:~${logsqlQuoted(`(?i)${escapeRegex(filter.query)}`)}`,
		)
	}
	return clauses.length > 0 ? ` | filter ${clauses.join(' ')}` : ''
}

/**
 * Build a LogsQL query for the most recent lines across the WHOLE fleet
 * (every VPS, every container + journald), newest first - optionally scoped by
 * the server-side `filter`. With NO filter it keeps the fast shape (unpack only
 * the 200 returned lines). With a filter it unpacks BEFORE filtering so the
 * service/search predicates see the lifted fields, then sorts + limits.
 */
export const buildFleetLogsQuery = (
	windowHours: number = DEFAULT_FLEET_LOG_HOURS,
	filter: FleetLogFilter = {},
): string => {
	const window = windowToLogsQL(windowHours)
	const limit = String(LOGSQL_QUERY_LIMIT)
	if (!hasFleetLogFilter(filter)) {
		return `_time:${window} | sort by (_time desc) | limit ${limit} ${UNPACK_PIPE}`
	}
	return `_time:${window}${streamScope(filter)} ${UNPACK_PIPE}${unpackedScope(filter)} | sort by (_time desc) | limit ${limit}`
}

/** Distinct values of a facet field over the window, for the filter dropdowns. */
export const buildLogFacetsQuery = (
	windowHours: number,
	field: 'nn_service' | 'nn_project',
): string =>
	`_time:${windowToLogsQL(windowHours)} ${UNPACK_PIPE} | uniq by (${field})`

/** Parse the `uniq by (field)` rows into a sorted, de-duped value list. */
export const parseLogFacet = (
	body: string,
	field: string,
): ReadonlyArray<string> => {
	const values = new Set<string>()
	for (const raw of body.split('\n')) {
		const trimmed = raw.trim()
		if (trimmed.length === 0) continue
		let parsed: unknown
		try {
			parsed = JSON.parse(trimmed)
		} catch {
			continue
		}
		if (!isRecord(parsed)) continue
		const cell = parsed[field]
		if (typeof cell === 'string' && cell.length > 0) values.add(cell)
	}
	return [...values].toSorted((left, right) => left.localeCompare(right))
}

/**
 * Build a LogsQL query that COUNTS error-level lines across the whole fleet
 * over `windowHours`. Crucial that this is a true windowed aggregate, NOT a
 * tally of `buildFleetLogsQuery`'s 200-line display sample: that sample is the
 * 200 NEWEST lines, so on a busy fleet it is the same set for every window and
 * its error tally never moves when the range changes. `stats count() if (...)`
 * (the same pipe `caddy-stats` uses) counts the whole window with no limit, so
 * the overview "Erreurs (X h)" stat finally tracks the selected range.
 */
export const buildFleetErrorCountQuery = (
	windowHours: number = DEFAULT_FLEET_LOG_HOURS,
): string =>
	[
		`_time:${windowToLogsQL(windowHours)}`,
		UNPACK_PIPE,
		`| stats count() if (level:~${logsqlQuoted(ERROR_LEVEL_PATTERN)} or severity:~${logsqlQuoted(ERROR_LEVEL_PATTERN)}) as errors`,
	].join(' ')

/**
 * Read a single named `stats count()` value out of a VictoriaLogs stats body
 * (one JSON row like `{"errors":"42"}`; counts come back as strings). Returns 0
 * when the row, the field, or the whole body is missing/unparseable - a count
 * query over an empty window legitimately yields no error lines.
 */
export const parseStatsCount = (body: string, field: string): number => {
	for (const raw of body.split('\n')) {
		const trimmed = raw.trim()
		if (trimmed.length === 0) continue
		let parsed: unknown
		try {
			parsed = JSON.parse(trimmed)
		} catch {
			continue
		}
		if (!isRecord(parsed)) continue
		const cell = parsed[field]
		const count = typeof cell === 'number' ? cell : Number(cell)
		if (Number.isFinite(count)) return count
	}
	return 0
}

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

// Fields lifted into named LogLine properties (so they are not duplicated in
// the free-form `meta` context table) plus VictoriaLogs internals.
const META_EXCLUDE = new Set([
	'container_name',
	'nn_project',
	'nn_service',
	'service',
	// `message`/`msg` become the LogLine message and `timestamp`/`time`
	// duplicate `_time` once `unpack_json` lifts them top-level - drop them
	// so they do not also surface in the free-form meta table. Genuinely
	// useful context the logger emits (requestId, location, scope, logger)
	// is intentionally NOT excluded and still flows into meta.
	'message',
	'msg',
	'timestamp',
	'time',
	'level',
	'severity',
	'status',
	'http_status',
	'method',
	'http_method',
	'path',
	'uri',
	'url',
	'http_path',
	'duration_ms',
	'durationMs',
	'duration',
	'trace_id',
	'traceId',
	'stack',
	'stacktrace',
	'exception',
])

const extractMeta = (
	parsed: Readonly<Record<string, unknown>>,
): Record<string, string> => {
	const meta: Record<string, string> = {}
	for (const [key, fieldValue] of Object.entries(parsed)) {
		if (key.startsWith('_') || META_EXCLUDE.has(key)) continue
		if (
			typeof fieldValue === 'string' ||
			typeof fieldValue === 'number' ||
			typeof fieldValue === 'boolean'
		) {
			meta[key] = String(fieldValue)
		}
	}
	return meta
}

// First present (non-null) value among a list of candidate field names -
// emitters disagree on spelling (status vs http_status, trace_id vs traceId).
const firstField = (
	parsed: Readonly<Record<string, unknown>>,
	keys: ReadonlyArray<string>,
): unknown => {
	for (const key of keys) {
		const candidate = parsed[key]
		if (typeof candidate !== 'undefined' && candidate !== null)
			return candidate
	}
	return undefined
}

const safeParse = (raw: string): LogLine | null => {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		return null
	}
	if (!isRecord(parsed)) return null
	// `_time` / `_msg` are VictoriaLogs' built-in field names; bracket access
	// keeps the underscore-prefixed contract out of dot notation. Empty `_msg`
	// is a valid line, so accept any string here (not parseStringOrNull).
	const timeField = parsed['_time']
	const msgField = parsed['_msg']
	const time = typeof timeField === 'string' ? timeField : null
	const rawMsg = typeof msgField === 'string' ? msgField : null
	if (time === null || rawMsg === null) return null
	// After `| unpack_json` the human message is the structured `message`
	// (logger) / `msg` (Caddy) field; `_msg` still holds the raw JSON blob.
	// Prefer the unpacked field so the UI shows "server started", not the
	// `{"level":…}` string. Plain journald lines have no such field, so we
	// fall back to `_msg`. Empty string is a valid message (keep the
	// "empty `_msg` is a valid line" rule), so accept any string here.
	const unpackedMsg = firstField(parsed, ['message', 'msg'])
	const message = typeof unpackedMsg === 'string' ? unpackedMsg : rawMsg
	return {
		time,
		message,
		container: parseStringOrNull(parsed.container_name),
		level: parseLogLevel(firstField(parsed, ['level', 'severity'])),
		service: parseStringOrNull(
			firstField(parsed, ['nn_service', 'service']),
		),
		vps: parseStringOrNull(parsed['nn_project']),
		status: parseFiniteNumber(
			firstField(parsed, ['status', 'http_status']),
		),
		method: parseStringOrNull(
			firstField(parsed, ['method', 'http_method']),
		),
		path: parseStringOrNull(
			firstField(parsed, ['path', 'uri', 'url', 'http_path']),
		),
		durationMs: parseFiniteNumber(
			firstField(parsed, ['duration_ms', 'durationMs', 'duration']),
		),
		traceId: parseStringOrNull(firstField(parsed, ['trace_id', 'traceId'])),
		stack: parseStringOrNull(
			firstField(parsed, ['stack', 'stacktrace', 'exception']),
		),
		meta: extractMeta(parsed),
	}
}
