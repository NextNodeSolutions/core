import { describe, expect, it } from 'vitest'

import {
	bucketLogs,
	countByLevel,
	filterLogs,
	histogramBars,
	logLineKey,
	nextActiveLevels,
	selectLogByKey,
} from './log-explorer.ts'
import { LOG_LEVELS } from './log-query.ts'

import type { LogBucket } from './log-explorer.ts'
import type { LogLevel, LogLine } from './log-query.ts'

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

describe('nextActiveLevels', () => {
	const all = LOG_LEVELS
	const sorted = (set: ReadonlySet<LogLevel>): ReadonlyArray<LogLevel> =>
		all.filter(level => set.has(level))

	it('isolates to the clicked level when starting from all (unfiltered)', () => {
		const next = nextActiveLevels(new Set(all), all, 'error')
		expect(sorted(next)).toEqual(['error'])
	})

	it('adds a level that is not yet active (additive multi-select)', () => {
		const next = nextActiveLevels(new Set<LogLevel>(['error']), all, 'warn')
		expect(sorted(next)).toEqual(['warn', 'error'])
	})

	it('removes an active level while others remain active', () => {
		const next = nextActiveLevels(
			new Set<LogLevel>(['warn', 'error']),
			all,
			'error',
		)
		expect(sorted(next)).toEqual(['warn'])
	})

	it('resets to all when removing the last active level (never empty)', () => {
		const next = nextActiveLevels(new Set<LogLevel>(['warn']), all, 'warn')
		expect(sorted(next)).toEqual([...all])
	})

	it('does not mutate the input set', () => {
		const current = new Set<LogLevel>(['warn', 'error'])
		nextActiveLevels(current, all, 'error')
		expect(sorted(current)).toEqual(['warn', 'error'])
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

describe('logLineKey', () => {
	it('uses the traceId when present', () => {
		expect(logLineKey(line({ traceId: 'abc123' }))).toBe('t:abc123')
	})

	it('derives a stable key from time and message when no traceId', () => {
		const sample = line({
			traceId: null,
			time: '2026-06-13T10:00:00Z',
			message: 'request done',
		})
		expect(logLineKey(sample)).toBe(logLineKey(sample))
	})

	it('gives distinct keys to two lines differing only in message', () => {
		const base = { traceId: null, time: '2026-06-13T10:00:00Z' }
		expect(logLineKey(line({ ...base, message: 'first' }))).not.toBe(
			logLineKey(line({ ...base, message: 'second' })),
		)
	})

	it('gives distinct keys to two lines differing only in time', () => {
		const base = { traceId: null, message: 'same' }
		expect(
			logLineKey(line({ ...base, time: '2026-06-13T10:00:00Z' })),
		).not.toBe(logLineKey(line({ ...base, time: '2026-06-13T10:00:01Z' })))
	})
})

describe('selectLogByKey', () => {
	const first = line({ traceId: 'a', message: 'first' })
	const second = line({ traceId: 'b', message: 'second' })
	const third = line({ traceId: 'c', message: 'third' })
	const logs = [first, second, third]

	it('finds the matching line by its stable key', () => {
		expect(selectLogByKey(logs, logLineKey(second))?.message).toBe('second')
	})

	it('finds the line even after the list is sliced past its position', () => {
		const sliced = [first, second]
		// `third` sits beyond the visible slice, yet the key still resolves it
		// from the full list - position-independent selection.
		expect(selectLogByKey(logs, logLineKey(third))?.message).toBe('third')
		expect(selectLogByKey(sliced, logLineKey(third))).toBeNull()
	})

	it('returns null for an unknown or empty key', () => {
		expect(selectLogByKey(logs, 'nope')).toBeNull()
		expect(selectLogByKey(logs, '')).toBeNull()
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
