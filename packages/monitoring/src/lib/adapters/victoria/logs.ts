import { queryVictoriaLogs } from '@/lib/adapters/victoria/client.ts'
import { clampInteger } from '@/lib/domain/clamp.ts'
import {
	buildCaddyStatsQuery,
	parseCaddyStats,
} from '@/lib/domain/monitoring/caddy-stats.ts'
import {
	buildContainerLogsQuery,
	buildFleetLogsQuery,
	buildVpsLogsQuery,
	parseLogLines,
} from '@/lib/domain/monitoring/log-query.ts'

import type { CaddyHostStat } from '@/lib/domain/monitoring/caddy-stats.ts'
import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * VictoriaLogs adapter: VPS / fleet / project log streams and the per-host
 * Caddy access summary (derived from Caddy's JSON access logs). Each loader
 * builds the LogsQL in domain, runs the query, and parses the NDJSON back to a
 * domain shape - no business decisions here.
 */

// Window bound for the fleet-log query, mirroring the domain's metric window
// (0, 720h]. Clamp at the boundary so a NaN/negative value never reaches the
// LogsQL `_time:` filter.
const FLEET_LOG_WINDOW_BOUNDS = { min: 1, max: 720, fallback: 6 } as const

/** Most-recent log lines from a whole VPS (container + journald), newest first. */
export const loadVpsLogs = async (
	vpsName: string,
): Promise<ReadonlyArray<LogLine>> => {
	const body = await queryVictoriaLogs(buildVpsLogsQuery(vpsName))
	return parseLogLines(body)
}

/** Most-recent log lines across the whole fleet over `windowHours`, newest first. */
export const loadFleetLogs = async (
	windowHours?: number,
): Promise<ReadonlyArray<LogLine>> => {
	// Omitted window keeps the domain default; a provided one is clamped so a
	// NaN/negative value never reaches the LogsQL `_time:` filter.
	const safeWindowHours =
		windowHours === undefined
			? undefined
			: clampInteger(windowHours, FLEET_LOG_WINDOW_BOUNDS)
	const body = await queryVictoriaLogs(buildFleetLogsQuery(safeWindowHours))
	return parseLogLines(body)
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
