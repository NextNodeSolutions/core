import { MOCK_DATA } from '@/lib/adapters/mock-data.ts'
import {
	mockFleetErrorCount,
	mockFleetLogs,
	mockFleetStats,
	mockLogFacets,
	mockVpsLogs,
} from '@/lib/adapters/mock-logs.ts'
import { queryVictoriaLogs } from '@/lib/adapters/victoria/client.ts'
import { clampNumber } from '@/lib/domain/clamp.ts'
import {
	buildCaddyStatsQuery,
	parseCaddyStats,
} from '@/lib/domain/monitoring/caddy-stats.ts'
import {
	buildFleetStatsQuery,
	histogramStepSeconds,
	parseFleetStats,
	windowMsFor,
} from '@/lib/domain/monitoring/log-aggregates.ts'
import {
	buildContainerLogsQuery,
	buildFleetErrorCountQuery,
	buildFleetLogsQuery,
	buildLogFacetsQuery,
	buildVpsLogsQuery,
	parseLogFacet,
	parseLogLines,
	parseStatsCount,
} from '@/lib/domain/monitoring/log-query.ts'
import { MIN_WINDOW_HOURS } from '@/lib/domain/monitoring/vps-metrics.ts'

import type { CaddyHostStat } from '@/lib/domain/monitoring/caddy-stats.ts'
import type { FleetLogStats } from '@/lib/domain/monitoring/log-aggregates.ts'
import type {
	FleetLogFilter,
	LogFacets,
	LogLine,
} from '@/lib/domain/monitoring/log-query.ts'

/**
 * VictoriaLogs adapter: VPS / fleet / project log streams and the per-host
 * Caddy access summary (derived from Caddy's JSON access logs). Each loader
 * builds the LogsQL in domain, runs the query, and parses the NDJSON back to a
 * domain shape - no business decisions here.
 */

// Window bound for the fleet-log query, mirroring the domain's metric window
// (0, 720h]. `min` is one minute (not 1h) so the live 5-minute window survives;
// `clampNumber` keeps the fraction. Guards NaN/negative/over-max at the boundary
// so a bad value never reaches the LogsQL `_time:` filter.
const FLEET_LOG_WINDOW_BOUNDS = {
	min: MIN_WINDOW_HOURS,
	max: 720,
	fallback: 6,
} as const

const clampWindowHours = (
	windowHours: number | undefined,
): number | undefined => {
	if (typeof windowHours === 'undefined') return undefined
	return clampNumber(windowHours, FLEET_LOG_WINDOW_BOUNDS)
}

/** Most-recent log lines from a whole VPS (container + journald), newest first. */
export const loadVpsLogs = async (
	vpsName: string,
): Promise<ReadonlyArray<LogLine>> => {
	if (MOCK_DATA) return mockVpsLogs(vpsName)
	const body = await queryVictoriaLogs(buildVpsLogsQuery(vpsName))
	return parseLogLines(body)
}

/**
 * Most-recent log lines across the whole fleet over `windowHours`, newest
 * first, optionally scoped by the server-side `filter` (service / vps / search)
 * so the /logs list matches the windowed stats. The overview passes no filter
 * (its preview is the whole fleet); /api/logs threads the operator's facets.
 */
export const loadFleetLogs = async (
	windowHours?: number,
	filter: FleetLogFilter = {},
): Promise<ReadonlyArray<LogLine>> => {
	if (MOCK_DATA) return mockFleetLogs(windowHours, filter)
	// Omitted window keeps the domain default; a provided one is clamped so a
	// NaN/negative value never reaches the LogsQL `_time:` filter.
	const safeWindowHours = clampWindowHours(windowHours)
	const body = await queryVictoriaLogs(
		buildFleetLogsQuery(safeWindowHours, filter),
	)
	return parseLogLines(body)
}

/**
 * True windowed error tally across the whole fleet over `windowHours`. Backs
 * the overview "Erreurs (X h)" stat. Decoupled from `loadFleetLogs` so the
 * count reflects the FULL window via `stats count()`, not the 200-line display
 * sample (which is range-invariant on a busy fleet). Window clamped like the
 * fleet-log query so a NaN/negative value never reaches the LogsQL filter.
 */
export const loadFleetErrorCount = async (
	windowHours?: number,
): Promise<number> => {
	if (MOCK_DATA) return mockFleetErrorCount(windowHours)
	const safeWindowHours = clampWindowHours(windowHours)
	const body = await queryVictoriaLogs(
		buildFleetErrorCountQuery(safeWindowHours),
	)
	return parseStatsCount(body, 'errors')
}

/**
 * Windowed /logs aggregates (histogram + per-level + total) over `windowHours`.
 * A true `stats by (_time:step, level)` aggregate of the WHOLE window, not a
 * bucketing of the 200-line display sample - so the histogram and counts track
 * the range. `nowMs` (the page's server-injected clock) anchors the bucket grid
 * so the bars line up with the log list's window.
 */
export const loadFleetStats = async (
	windowHours: number,
	nowMs: number,
	filter: FleetLogFilter = {},
): Promise<FleetLogStats> => {
	const safeWindowHours = clampNumber(windowHours, FLEET_LOG_WINDOW_BOUNDS)
	if (MOCK_DATA) return mockFleetStats(safeWindowHours, nowMs, filter)
	const body = await queryVictoriaLogs(
		buildFleetStatsQuery(
			safeWindowHours,
			histogramStepSeconds(safeWindowHours),
			filter,
		),
	)
	return parseFleetStats(body, {
		nowMs,
		windowMs: windowMsFor(safeWindowHours),
	})
}

/**
 * Distinct service + vps values over the window, for the /logs filter
 * dropdowns. Unscoped by the current facet selection (so the operator can
 * always switch facets), unlike the sample/stats which ARE scoped.
 */
export const loadLogFacets = async (
	windowHours: number,
): Promise<LogFacets> => {
	const safeWindowHours = clampNumber(windowHours, FLEET_LOG_WINDOW_BOUNDS)
	if (MOCK_DATA) return mockLogFacets()
	const [serviceBody, vpsBody] = await Promise.all([
		queryVictoriaLogs(buildLogFacetsQuery(safeWindowHours, 'nn_service')),
		queryVictoriaLogs(buildLogFacetsQuery(safeWindowHours, 'nn_project')),
	])
	return {
		services: parseLogFacet(serviceBody, 'nn_service'),
		vps: parseLogFacet(vpsBody, 'nn_project'),
	}
}

/** Most-recent container log lines for one project, across its host VPS. */
export const loadProjectLogs = async (
	project: string,
): Promise<ReadonlyArray<LogLine>> => {
	const body = await queryVictoriaLogs(buildContainerLogsQuery(project))
	return parseLogLines(body)
}

/** Per-domain Caddy access summary for a VPS over the last hour. */
export const loadVpsCaddyStats = async (
	vpsName: string,
): Promise<ReadonlyArray<CaddyHostStat>> => {
	const body = await queryVictoriaLogs(buildCaddyStatsQuery(vpsName))
	return parseCaddyStats(body)
}
