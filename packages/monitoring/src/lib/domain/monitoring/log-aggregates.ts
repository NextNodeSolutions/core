import { isRecord } from '@/lib/domain/is-record.ts'
import {
	ALL,
	bucketLogs,
	countByLevel,
} from '@/lib/domain/monitoring/log-explorer.ts'
import { parseLogLevel } from '@/lib/domain/monitoring/log-query.ts'
import {
	MIN_WINDOW_HOURS,
	windowToLogsQL,
} from '@/lib/domain/monitoring/vps-metrics.ts'

import type {
	LevelCounts,
	LogBucket,
} from '@/lib/domain/monitoring/log-explorer.ts'
import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * The /logs page's WINDOWED aggregates - the volume histogram, the per-level
 * tallies behind the chips, and the total line count over the selected range.
 *
 * These MUST come from a server-side aggregation over the whole window, NOT
 * from the page's fetched log list. That list is the 200 NEWEST lines
 * (`buildFleetLogsQuery`), so on a busy fleet it is the same set for every
 * range - bucketing it client-side made the histogram and counts freeze when
 * the time filter changed. `buildFleetStatsQuery` aggregates the entire window
 * with `stats by (_time:step, level)`, so the picture finally tracks the range.
 * The fetched list stays a recent display sample, filtered client-side.
 */

/** Number of histogram buckets across the window (one bar each). */
export const HISTOGRAM_BUCKETS = 72
const SECONDS_PER_HOUR = 3600
const MS_PER_HOUR = 3_600_000

export interface FleetLogStats {
	/** Dense, time-ordered histogram buckets spanning the whole window. */
	readonly buckets: ReadonlyArray<LogBucket>
	/** Per-level line totals over the window (the chip counts). */
	readonly levelCounts: LevelCounts
	/** Total lines over the window. */
	readonly total: number
}

const emptyLevelCounts = (): LevelCounts => ({
	debug: 0,
	info: 0,
	warn: 0,
	error: 0,
})

/** The "nothing loaded / upstream down" stats - an honest empty, never faked. */
export const EMPTY_FLEET_STATS: FleetLogStats = {
	buckets: [],
	levelCounts: emptyLevelCounts(),
	total: 0,
}

/**
 * LogsQL bucket step (seconds) that splits `windowHours` into ~HISTOGRAM_BUCKETS
 * buckets. Floored at 1s so a sub-bucket window never asks for a zero step.
 */
export const histogramStepSeconds = (windowHours: number): number =>
	Math.max(
		1,
		Math.round(
			(Math.max(MIN_WINDOW_HOURS, windowHours) * SECONDS_PER_HOUR) /
				HISTOGRAM_BUCKETS,
		),
	)

/**
 * Build the windowed fleet-stats query: count lines per (time bucket, level)
 * across the whole window. `unpack_json` lifts the `level` field trapped in
 * `_msg` (same reason as the log-line query) so the grouping sees it. No
 * `limit` - this is a true aggregate, the whole point of the fix.
 */
export const buildFleetStatsQuery = (
	windowHours: number,
	stepSeconds: number,
): string =>
	`_time:${windowToLogsQL(windowHours)} | unpack_json | stats by (_time:${String(stepSeconds)}s, level) count() as hits`

const emptyBucket = (t: number): LogBucket => ({
	t,
	debug: 0,
	info: 0,
	warn: 0,
	error: 0,
	total: 0,
})

export interface StatsGrid {
	/** The page's stable "now" (server-injected), the right edge of the grid. */
	readonly nowMs: number
	/** Window span in ms; the grid runs `nowMs - windowMs` .. `nowMs`. */
	readonly windowMs: number
}

/**
 * Parse the `stats by (_time:step, level) count()` rows VictoriaLogs returns
 * (newline-delimited JSON like `{"_time":"…","level":"error","hits":"25"}`;
 * counts come back as strings) into a dense histogram + per-level totals + a
 * grand total. The buckets are laid on the same `nowMs - windowMs` .. `nowMs`
 * grid the histogram renders, so a row's bucket time maps straight to a bar.
 * Rows with a NaN/zero count or an unparseable time are skipped; a level the UI
 * does not render still counts toward the total but no chip.
 */
export const parseFleetStats = (
	body: string,
	grid: StatsGrid,
): FleetLogStats => {
	const bucketMs = grid.windowMs / HISTOGRAM_BUCKETS
	const start = grid.nowMs - grid.windowMs
	const buckets = Array.from({ length: HISTOGRAM_BUCKETS }, (_, index) =>
		emptyBucket(start + index * bucketMs),
	)
	const levelCounts = emptyLevelCounts()
	let total = 0
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
		const hits = Number(parsed.hits)
		if (!Number.isFinite(hits) || hits <= 0) continue
		// `_time` is VictoriaLogs' built-in field; the stats bucket carries it as
		// an RFC3339 string (same convention as a log line's `_time`). Parse it
		// FIRST and skip the whole row when it is unusable, so the per-level and
		// grand totals stay equal to the histogram sum (no counted-but-unplaced
		// hits drifting the tallies away from the bars).
		const timeField = parsed['_time']
		const at = Date.parse(typeof timeField === 'string' ? timeField : '')
		// Only an unparseable time is dropped. Every row here was already bounded
		// to the window by the `_time:` filter, so we CLAMP its bucket index into
		// the grid rather than re-testing `at` against `start`/`nowMs`: VictoriaLogs
		// aligns `stats by (_time:step)` buckets to absolute epoch multiples, so the
		// oldest bucket's label sits up to one step BEFORE `start`, and clock skew
		// can push the newest a hair past `nowMs`. Re-filtering would silently drop
		// those real edge buckets - under-counting the total and blanking the end
		// bars (and disagreeing with the un-bucketed `loadFleetErrorCount`).
		if (Number.isNaN(at)) continue
		const index = Math.min(
			HISTOGRAM_BUCKETS - 1,
			Math.max(0, Math.floor((at - start) / bucketMs)),
		)
		const bucket = buckets[index]
		if (bucket === undefined) continue
		total += hits
		const level = parseLogLevel(parsed.level)
		if (level !== null) levelCounts[level] += hits
		bucket.total += hits
		if (level !== null) bucket[level] += hits
	}
	return { buckets, levelCounts, total }
}

/**
 * Build the same `FleetLogStats` straight from an already-loaded line list,
 * reusing the pure bucketing/counting. Used by the offline mock (and the test
 * fixtures) so MOCK mode exercises the exact same windowed shape the real
 * `stats` query produces - just sourced from the mock fleet lines.
 */
export const fleetStatsFromLogs = (
	logs: ReadonlyArray<LogLine>,
	grid: StatsGrid,
): FleetLogStats => ({
	buckets: bucketLogs(logs, {
		bucketCount: HISTOGRAM_BUCKETS,
		windowMs: grid.windowMs,
		nowMs: grid.nowMs,
	}),
	levelCounts: countByLevel(logs, { service: ALL, vps: ALL }),
	total: logs.length,
})

/** Window span in ms for `windowHours` - the histogram grid's width. */
export const windowMsFor = (windowHours: number): number =>
	Math.max(MIN_WINDOW_HOURS, windowHours) * MS_PER_HOUR

const toCount = (raw: unknown): number =>
	typeof raw === 'number' && Number.isFinite(raw) ? raw : 0

const toLevelCounts = (raw: unknown): LevelCounts => {
	const record = isRecord(raw) ? raw : {}
	return {
		debug: toCount(record.debug),
		info: toCount(record.info),
		warn: toCount(record.warn),
		error: toCount(record.error),
	}
}

const toBucket = (raw: unknown): LogBucket => {
	const record = isRecord(raw) ? raw : {}
	return {
		t: toCount(record.t),
		debug: toCount(record.debug),
		info: toCount(record.info),
		warn: toCount(record.warn),
		error: toCount(record.error),
		total: toCount(record.total),
	}
}

/**
 * The CLIENT trust boundary for the `stats` field of `/api/logs`: coerce the
 * untyped JSON the island deserialises back into a `FleetLogStats`, rebuilding
 * each numeric field rather than trusting the wire shape blindly (the same
 * stance as the overview island's `parseWindow`). A missing/garbled payload
 * collapses to the honest empty stats, never a half-typed object the histogram
 * would choke on.
 */
export const coerceFleetStats = (raw: unknown): FleetLogStats => {
	if (!isRecord(raw)) return EMPTY_FLEET_STATS
	return {
		buckets: Array.isArray(raw.buckets) ? raw.buckets.map(toBucket) : [],
		levelCounts: toLevelCounts(raw.levelCounts),
		total: toCount(raw.total),
	}
}
