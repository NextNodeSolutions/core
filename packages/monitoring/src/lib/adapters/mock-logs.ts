// oxlint-disable no-magic-numbers -- fixtures module: the literals ARE the data.
import {
	fleetStatsFromLogs,
	windowMsFor,
} from '@/lib/domain/monitoring/log-aggregates.ts'
import { MIN_WINDOW_HOURS } from '@/lib/domain/monitoring/vps-metrics.ts'

import type { FleetLogStats } from '@/lib/domain/monitoring/log-aggregates.ts'
import type {
	FleetLogFilter,
	LogFacets,
	LogLine,
} from '@/lib/domain/monitoring/log-query.ts'

/**
 * Local-only LOG fixtures for `MOCK_DATA=1` - the fleet log sample, its windowed
 * aggregates, the error tally and the facet lists. Split from `mock-data.ts`
 * (which keeps the server/metric fixtures) to stay focused. Range-dependent on
 * purpose: line count + spread scale with the window, and the filter is honoured
 * server-style, so MOCK mode exercises the real range/facet behaviour offline.
 */

const SERVICES = ['app', 'api', 'caddy', 'worker', 'cron'] as const
const VPS_NAMES = ['nn-prod', 'nn-internals', 'nn-staging'] as const
const LINES: ReadonlyArray<{ level: LogLine['level']; message: string }> = [
	{ level: 'info', message: 'GET /api/health 200 in 4ms' },
	{ level: 'info', message: 'request completed' },
	{ level: 'warn', message: 'slow query: 812ms on projects.list' },
	{ level: 'error', message: 'upstream timeout reaching cloudflare api' },
	{ level: 'info', message: 'cache hit ratio 0.93' },
	{ level: 'debug', message: 'scheduler tick: 3 jobs enqueued' },
	{ level: 'info', message: 'deploy webhook accepted' },
	{ level: 'warn', message: 'memory pressure 78% on container' },
	{ level: 'error', message: 'ECONNRESET while streaming logs' },
	{ level: 'info', message: 'POST /api/overview 200 in 21ms' },
	{ level: 'debug', message: 'jwt verified for operator session' },
	{ level: 'info', message: 'background backup completed (1.2 GB)' },
]

const MS_PER_HOUR = 3_600_000
const MOCK_LOG_LINES_PER_HOUR = 8
// Low floor so the 5-minute live window shows FEWER lines (and errors) than the
// 1h window - the whole point of making `live` a distinct short window.
const MIN_MOCK_LOG_LINES = 2
const MAX_MOCK_LOG_LINES = 240
const DEFAULT_MOCK_LOG_HOURS = 6

/**
 * How many synthetic lines a `windowHours` window holds: more time -> more logs
 * (and proportionally more errors), so the windowed stats and the histogram
 * MOVE when the range changes. Clamped so even a 24h window stays light.
 */
const mockLogCount = (windowHours: number): number =>
	Math.min(
		MAX_MOCK_LOG_LINES,
		Math.max(
			MIN_MOCK_LOG_LINES,
			Math.round(
				Math.max(MIN_WINDOW_HOURS, windowHours) *
					MOCK_LOG_LINES_PER_HOUR,
			),
		),
	)

// Mirror the server-side scope (service/vps exact, case-insensitive substring
// search over the message) so MOCK mode exercises the same filtered shape.
const matchesMockFilter = (line: LogLine, filter: FleetLogFilter): boolean => {
	if (filter.service && line.service !== filter.service) return false
	if (filter.vps && line.vps !== filter.vps) return false
	if (
		filter.query &&
		!line.message.toLowerCase().includes(filter.query.toLowerCase())
	) {
		return false
	}
	return true
}

/**
 * Synthetic fleet logs for `windowHours`, newest first, then narrowed by the
 * server-style `filter`. Count scales with the window and timestamps spread
 * ACROSS it, so a range change visibly moves the error count and redraws the
 * histogram. Content cycles deterministically through `LINES`.
 */
export const mockFleetLogs = (
	windowHours: number = DEFAULT_MOCK_LOG_HOURS,
	filter: FleetLogFilter = {},
): ReadonlyArray<LogLine> => {
	const nowMs = Date.now()
	const windowMs = Math.max(MIN_WINDOW_HOURS, windowHours) * MS_PER_HOUR
	const count = mockLogCount(windowHours)
	return Array.from({ length: count }, (_, index) => {
		const line = LINES[index % LINES.length] ?? {
			level: 'info' as const,
			message: '',
		}
		// index 0 = newest; the +0.5 offset keeps even the freshest line a few
		// minutes old, so it never lands ahead of the page's injected `now`.
		const ageMs = ((index + 0.5) / count) * windowMs
		return {
			time: new Date(nowMs - ageMs).toISOString(),
			message: line.message,
			container: null,
			level: line.level,
			service: SERVICES[index % SERVICES.length] ?? null,
			vps: VPS_NAMES[index % VPS_NAMES.length] ?? null,
			status: null,
			method: null,
			path: null,
			durationMs: null,
			traceId: null,
			stack: null,
			meta: {},
		}
	}).filter(line => matchesMockFilter(line, filter))
}

export const mockVpsLogs = (vpsName: string): ReadonlyArray<LogLine> => {
	const own = mockFleetLogs().filter(line => line.vps === vpsName)
	return own.length > 0 ? own : mockFleetLogs()
}

/**
 * Windowed fleet error tally - the offline stand-in for the real `stats count()`
 * query, NOT a count of a capped sample. Scales with the window.
 */
export const mockFleetErrorCount = (
	windowHours: number = DEFAULT_MOCK_LOG_HOURS,
): number =>
	mockFleetLogs(windowHours).filter(line => line.level === 'error').length

/**
 * Windowed /logs aggregates for offline mode - the stand-in for the real
 * `stats by (_time:step, level)` query, built from the same window-scaled,
 * filter-scoped `mockFleetLogs` so the histogram + counts track range + facets.
 */
export const mockFleetStats = (
	windowHours: number,
	nowMs: number,
	filter: FleetLogFilter = {},
): FleetLogStats =>
	fleetStatsFromLogs(mockFleetLogs(windowHours, filter), {
		nowMs,
		windowMs: windowMsFor(windowHours),
	})

/** Distinct service + vps facet values for the offline /logs dropdowns. */
export const mockLogFacets = (): LogFacets => ({
	services: [...SERVICES].toSorted((a, b) => a.localeCompare(b)),
	vps: [...VPS_NAMES].toSorted((a, b) => a.localeCompare(b)),
})
