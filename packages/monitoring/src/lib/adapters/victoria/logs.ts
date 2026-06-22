import {
	MOCK_DATA,
	mockFleetErrorCount,
	mockFleetLogs,
	mockFleetStats,
	mockVpsLogs,
} from '@/lib/adapters/mock-data.ts'
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
	buildVpsLogsQuery,
	parseLogLines,
	parseStatsCount,
} from '@/lib/domain/monitoring/log-query.ts'
import { MIN_WINDOW_HOURS } from '@/lib/domain/monitoring/vps-metrics.ts'

import type { CaddyHostStat } from '@/lib/domain/monitoring/caddy-stats.ts'
import type { FleetLogStats } from '@/lib/domain/monitoring/log-aggregates.ts'
import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'

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

/** Most-recent log lines from a whole VPS (container + journald), newest first. */
export const loadVpsLogs = async (
	vpsName: string,
): Promise<ReadonlyArray<LogLine>> => {
	if (MOCK_DATA) return mockVpsLogs(vpsName)
	const body = await queryVictoriaLogs(buildVpsLogsQuery(vpsName))
	return parseLogLines(body)
}

/** Most-recent log lines across the whole fleet over `windowHours`, newest first. */
export const loadFleetLogs = async (
	windowHours?: number,
): Promise<ReadonlyArray<LogLine>> => {
	if (MOCK_DATA) return mockFleetLogs(windowHours)
	// Omitted window keeps the domain default; a provided one is clamped so a
	// NaN/negative value never reaches the LogsQL `_time:` filter.
	const safeWindowHours =
		windowHours === undefined
			? undefined
			: clampNumber(windowHours, FLEET_LOG_WINDOW_BOUNDS)
	const body = await queryVictoriaLogs(buildFleetLogsQuery(safeWindowHours))
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
	const safeWindowHours =
		windowHours === undefined
			? undefined
			: clampNumber(windowHours, FLEET_LOG_WINDOW_BOUNDS)
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
): Promise<FleetLogStats> => {
	const safeWindowHours = clampNumber(windowHours, FLEET_LOG_WINDOW_BOUNDS)
	if (MOCK_DATA) return mockFleetStats(safeWindowHours, nowMs)
	const body = await queryVictoriaLogs(
		buildFleetStatsQuery(
			safeWindowHours,
			histogramStepSeconds(safeWindowHours),
		),
	)
	return parseFleetStats(body, {
		nowMs,
		windowMs: windowMsFor(safeWindowHours),
	})
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
