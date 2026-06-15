import { describe, expect, it } from 'vitest'

import {
	bucketLogs,
	countByLevel,
	filterLogs,
	histogramBars,
} from './log-explorer.ts'

import type { LogBucket } from './log-explorer.ts'
import type { LogLine } from './log-query.ts'

const line = (over: Partial<LogLine>): LogLine => ({
	time: '2026-06-13T10:00:00Z',
	message: '',
	container: null,
	level: 'info',
	service: null,
	vps: null,
	status: null,
	method: null,
	path: null,
	durationMs: null,
	traceId: null,
	stack: null,
	meta: {},
	...over,
})

describe('filterLogs', () => {
	const logs = [
		line({ level: 'info', message: 'hello', service: 'web', vps: 'a' }),
		line({ level: 'warn', message: 'careful', service: 'web', vps: 'b' }),
		line({
			level: null,
			message: 'uncategorised',
			service: 'cron',
			vps: 'a',
		}),
	]

	it('keeps active levels and always keeps null-level lines', () => {
		const kept = filterLogs(logs, {
			query: '',
			levels: ['warn'],
			service: 'all',
			vps: 'all',
		})
		expect(kept.map(entry => entry.message)).toEqual([
			'careful',
			'uncategorised',
		])
	})

	it('filters by service and vps', () => {
		const kept = filterLogs(logs, {
			query: '',
			levels: ['debug', 'info', 'warn', 'error'],
			service: 'web',
			vps: 'a',
		})
		expect(kept.map(entry => entry.message)).toEqual(['hello'])
	})

	it('matches the query against message, path and traceId, case-insensitively', () => {
		const logsWithReq = [
			line({ message: 'GET failed', path: '/api/users', traceId: 'abc' }),
			line({ message: 'noise', path: '/health', traceId: 'zzz' }),
		]
		expect(
			filterLogs(logsWithReq, {
				query: 'API/USERS',
				levels: ['info'],
				service: 'all',
				vps: 'all',
			}).map(entry => entry.path),
		).toEqual(['/api/users'])
	})
})

describe('countByLevel', () => {
	it('counts each level within the service/vps scope, ignoring null levels', () => {
		const logs = [
			line({ level: 'info', service: 'web' }),
			line({ level: 'info', service: 'web' }),
			line({ level: 'warn', service: 'web' }),
			line({ level: 'error', service: 'cron' }),
			line({ level: null, service: 'web' }),
		]
		expect(countByLevel(logs, { service: 'web', vps: 'all' })).toEqual({
			debug: 0,
			info: 2,
			warn: 1,
			error: 0,
		})
	})
})

describe('bucketLogs', () => {
	const now = Date.UTC(2026, 5, 15, 12, 0, 0)
	const WINDOW_MS = 3_600_000
	const BUCKETS = 4

	it('places logs in their time bucket and tallies per level + total', () => {
		const logs = [
			line({ time: new Date(now - 1_000).toISOString(), level: 'error' }),
			line({
				time: new Date(now - WINDOW_MS + 1_000).toISOString(),
				level: 'info',
			}),
			line({ time: new Date(now - 1_000).toISOString(), level: null }),
		]
		const buckets = bucketLogs(logs, {
			bucketCount: BUCKETS,
			windowMs: WINDOW_MS,
			nowMs: now,
		})
		expect(buckets).toHaveLength(BUCKETS)
		expect(buckets[3]).toMatchObject({ error: 1, total: 2 })
		expect(buckets[0]).toMatchObject({ info: 1, total: 1 })
	})

	it('drops logs outside the window', () => {
		const logs = [
			line({ time: new Date(now - WINDOW_MS - 10_000).toISOString() }),
		]
		const buckets = bucketLogs(logs, {
			bucketCount: BUCKETS,
			windowMs: WINDOW_MS,
			nowMs: now,
		})
		expect(buckets.reduce((sum, bucket) => sum + bucket.total, 0)).toBe(0)
	})
})

const bucket = (over: Partial<LogBucket>): LogBucket => ({
	t: 0,
	debug: 0,
	info: 0,
	warn: 0,
	error: 0,
	total: 0,
	...over,
})

describe('histogramBars', () => {
	it('stacks levels from the bottom and scales to the busiest bucket', () => {
		const bars = histogramBars(
			[bucket({ error: 2, info: 1, total: 3 }), bucket({ total: 0 })],
			{ width: 100, height: 50 },
		)
		expect(bars).toHaveLength(2)
		expect(bars[0]?.x).toBe(0)
		expect(bars[0]?.segments.map(segment => segment.level)).toEqual([
			'error',
			'info',
		])
		expect(bars[1]?.segments).toHaveLength(0)
		// every segment sits inside the chart band
		for (const segment of bars[0]?.segments ?? []) {
			expect(segment.y).toBeGreaterThanOrEqual(0)
			expect(segment.y).toBeLessThanOrEqual(50)
		}
	})

	it('returns nothing for no buckets', () => {
		expect(histogramBars([], { width: 100, height: 50 })).toEqual([])
	})
})
