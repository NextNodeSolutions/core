import { LOG_LEVELS } from '@/lib/domain/monitoring/log-query.ts'

import type { LogLevel, LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * Pure log-explorer logic: filtering, per-level counts and time bucketing.
 * The page collects filter state from query params and hands it here; nothing
 * touches IO or the clock (bucketing takes an explicit `nowMs`).
 */

export interface LogFilter {
	readonly query: string
	readonly levels: ReadonlyArray<LogLevel>
	readonly service: string
	readonly vps: string
}

export interface LogScope {
	readonly service: string
	readonly vps: string
}

export type LevelCounts = Record<LogLevel, number>

export interface LogBucket {
	t: number
	debug: number
	info: number
	warn: number
	error: number
	total: number
}

export interface BucketOptions {
	readonly bucketCount: number
	readonly windowMs: number
	readonly nowMs: number
}

const ALL = 'all'
const HIST_BAR_GAP = 1.5
const HIST_TOP_PAD = 4
const HIST_SEGMENT_GAP = 0.5
const HIST_MIN_BAR = 1

const matchesQuery = (line: LogLine, query: string): boolean => {
	if (query.length === 0) return true
	const haystack = [line.message, line.service, line.path, line.traceId]
		.filter((part): part is string => part !== null && part.length > 0)
		.join(' ')
		.toLowerCase()
	return haystack.includes(query.toLowerCase())
}

const inScope = (line: LogLine, scope: LogScope): boolean => {
	if (scope.service !== ALL && line.service !== scope.service) return false
	if (scope.vps !== ALL && line.vps !== scope.vps) return false
	return true
}

export const filterLogs = (
	logs: ReadonlyArray<LogLine>,
	filter: LogFilter,
): ReadonlyArray<LogLine> =>
	logs.filter(line => {
		// A categorised level must be active; uncategorised (null) lines always
		// pass the chip filter since no chip represents them.
		if (line.level !== null && !filter.levels.includes(line.level))
			return false
		if (!inScope(line, filter)) return false
		return matchesQuery(line, filter.query)
	})

export const countByLevel = (
	logs: ReadonlyArray<LogLine>,
	scope: LogScope,
): LevelCounts => {
	const counts: LevelCounts = { debug: 0, info: 0, warn: 0, error: 0 }
	for (const line of logs) {
		if (!inScope(line, scope)) continue
		if (line.level !== null) counts[line.level] += 1
	}
	return counts
}

const emptyBucket = (t: number): LogBucket => ({
	t,
	debug: 0,
	info: 0,
	warn: 0,
	error: 0,
	total: 0,
})

export const bucketLogs = (
	logs: ReadonlyArray<LogLine>,
	options: BucketOptions,
): LogBucket[] => {
	const bucketMs = options.windowMs / options.bucketCount
	const start = options.nowMs - options.windowMs
	const buckets = Array.from({ length: options.bucketCount }, (_, index) =>
		emptyBucket(start + index * bucketMs),
	)
	for (const line of logs) {
		const at = Date.parse(line.time)
		if (Number.isNaN(at) || at < start || at > options.nowMs) continue
		const index = Math.min(
			options.bucketCount - 1,
			Math.floor((at - start) / bucketMs),
		)
		const bucket = buckets[index]
		if (bucket === undefined) continue
		bucket.total += 1
		if (line.level !== null) bucket[line.level] += 1
	}
	return buckets
}

/** The four levels in stacking order (error at the bottom of the histogram). */
export const HISTOGRAM_LEVEL_ORDER: ReadonlyArray<LogLevel> =
	LOG_LEVELS.toReversed()

export interface HistogramSegment {
	readonly level: LogLevel
	readonly y: number
	readonly height: number
}

export interface HistogramBar {
	readonly x: number
	readonly width: number
	readonly segments: ReadonlyArray<HistogramSegment>
}

export interface HistogramLayout {
	readonly width: number
	readonly height: number
}

/**
 * Lay out a stacked-bar histogram: one bar per bucket, levels stacked from the
 * bottom (error first) and scaled against the busiest bucket. Pure geometry in
 * a fixed coordinate space for the server-rendered SVG.
 */
export const histogramBars = (
	buckets: ReadonlyArray<LogBucket>,
	layout: HistogramLayout,
): ReadonlyArray<HistogramBar> => {
	const count = buckets.length
	if (count === 0) return []
	const barWidth = Math.max(
		HIST_MIN_BAR,
		(layout.width - (count - 1) * HIST_BAR_GAP) / count,
	)
	const maxTotal = Math.max(...buckets.map(bucket => bucket.total), 1)
	const usableHeight = layout.height - HIST_TOP_PAD
	return buckets.map((bucket, index) => {
		const segments: HistogramSegment[] = []
		let cursor = layout.height
		for (const level of HISTOGRAM_LEVEL_ORDER) {
			const levelCount = bucket[level]
			if (levelCount === 0) continue
			const segmentHeight = (levelCount / maxTotal) * usableHeight
			cursor -= segmentHeight
			segments.push({
				level,
				y: cursor,
				height: Math.max(0, segmentHeight - HIST_SEGMENT_GAP),
			})
		}
		return {
			x: index * (barWidth + HIST_BAR_GAP),
			width: barWidth,
			segments,
		}
	})
}
