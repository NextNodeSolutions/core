import { describe, expect, it } from 'vitest'

import {
	buildFleetStatsQuery,
	coerceFleetStats,
	EMPTY_FLEET_STATS,
	fleetStatsFromLogs,
	HISTOGRAM_BUCKETS,
	histogramStepSeconds,
	parseFleetStats,
} from './log-aggregates.ts'

import type { LogLine } from './log-query.ts'

/**
 * The windowed /logs aggregates. The contract that fixes the frozen-stat bug:
 * the histogram + per-level + total reflect the WHOLE window (a server
 * aggregate), never the 200-line display sample. These tests pin the query
 * shape, the bucket placement, and the wire trust boundary.
 */

const NOW_MS = Date.parse('2026-06-15T12:00:00.000Z')
const SIX_HOURS_MS = 6 * 60 * 60 * 1000

describe('histogramStepSeconds', () => {
	it('splits the window into ~HISTOGRAM_BUCKETS buckets', () => {
		expect(histogramStepSeconds(24)).toBe(1200) // 24h / 72 = 20min
		expect(histogramStepSeconds(6)).toBe(300) // 6h / 72 = 5min
	})

	it('never returns a zero step for a tiny window', () => {
		expect(histogramStepSeconds(0)).toBeGreaterThanOrEqual(1)
	})
})

describe('buildFleetStatsQuery', () => {
	it('aggregates the whole window by (time bucket, level) - no limit', () => {
		const query = buildFleetStatsQuery(24, 1200)
		expect(query).toContain('_time:24h')
		expect(query).toContain('| unpack_json')
		expect(query).toContain('stats by (_time:1200s, level)')
		expect(query).toContain('count() as hits')
		// A true aggregate, NOT a newest-N display sample (the frozen-stat bug).
		expect(query).not.toContain('limit')
		expect(query).not.toContain('sort by')
	})
})

describe('parseFleetStats', () => {
	const body = [
		// two levels in the same recent bucket...
		JSON.stringify({
			_time: '2026-06-15T11:30:00.000Z',
			level: 'error',
			hits: '3',
		}),
		JSON.stringify({
			_time: '2026-06-15T11:30:00.000Z',
			level: 'info',
			hits: '10',
		}),
		// ...and one older bucket.
		JSON.stringify({
			_time: '2026-06-15T07:00:00.000Z',
			level: 'warn',
			hits: '2',
		}),
		// noise rows that must be ignored.
		JSON.stringify({ _time: 'not-a-date', level: 'error', hits: '99' }),
		JSON.stringify({ _time: '2026-06-15T11:30:00.000Z', hits: 'NaN' }),
		'',
	].join('\n')

	const stats = parseFleetStats(body, {
		nowMs: NOW_MS,
		windowMs: SIX_HOURS_MS,
	})

	it('lays a dense bucket grid across the window', () => {
		expect(stats.buckets).toHaveLength(HISTOGRAM_BUCKETS)
	})

	it('sums hits into the per-level totals and the grand total', () => {
		expect(stats.levelCounts).toEqual({
			debug: 0,
			info: 10,
			warn: 2,
			error: 3,
		})
		// The unparseable-time error row (hits 99) is excluded from the total.
		expect(stats.total).toBe(15)
	})

	it('places each row in its time bucket (5-min buckets over 6h)', () => {
		// 11:30 is 5.5h after start (06:00) -> bucket 66; 07:00 -> bucket 12.
		expect(stats.buckets[66]).toMatchObject({
			error: 3,
			info: 10,
			total: 13,
		})
		expect(stats.buckets[12]).toMatchObject({ warn: 2, total: 2 })
	})
})

const logLine = (overrides: Partial<LogLine>): LogLine => ({
	time: '2026-06-15T11:59:00.000Z',
	message: 'x',
	container: null,
	level: 'info',
	service: 'app',
	vps: 'nn-prod',
	status: null,
	method: null,
	path: null,
	durationMs: null,
	traceId: null,
	stack: null,
	meta: {},
	...overrides,
})

describe('fleetStatsFromLogs', () => {
	it('derives the same windowed shape straight from a line list', () => {
		const stats = fleetStatsFromLogs(
			[
				logLine({ level: 'error' }),
				logLine({ level: 'info' }),
				logLine({ level: null }),
			],
			{ nowMs: NOW_MS, windowMs: SIX_HOURS_MS },
		)
		expect(stats.total).toBe(3)
		expect(stats.levelCounts).toEqual({
			debug: 0,
			info: 1,
			warn: 0,
			error: 1,
		})
		expect(stats.buckets).toHaveLength(HISTOGRAM_BUCKETS)
	})
})

describe('coerceFleetStats (client trust boundary)', () => {
	it('rebuilds a well-formed wire payload field by field', () => {
		const wire = {
			buckets: [{ t: 1, debug: 0, info: 4, warn: 0, error: 1, total: 5 }],
			levelCounts: { debug: 0, info: 4, warn: 0, error: 1 },
			total: 5,
		}
		expect(coerceFleetStats(wire)).toEqual(wire)
	})

	it('collapses a missing or garbled payload to the empty stats', () => {
		expect(coerceFleetStats(null)).toEqual(EMPTY_FLEET_STATS)
		expect(
			coerceFleetStats({
				buckets: 'nope',
				levelCounts: null,
				total: '5',
			}),
		).toEqual(EMPTY_FLEET_STATS)
	})
})
