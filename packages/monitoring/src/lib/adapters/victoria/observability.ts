import {
	queryVictoriaLogs,
	queryVictoriaMetricsInstant,
	queryVictoriaMetricsRange,
} from '@/lib/adapters/victoria/client.ts'
import { clampInteger } from '@/lib/domain/clamp.ts'
import {
	buildCaddyStatsQuery,
	parseCaddyStats,
} from '@/lib/domain/monitoring/caddy-stats.ts'
import { buildHostMetricExprs } from '@/lib/domain/monitoring/host-metrics.ts'
import {
	buildContainerLogsQuery,
	buildFleetLogsQuery,
	buildVpsLogsQuery,
	parseLogLines,
} from '@/lib/domain/monitoring/log-query.ts'
import { buildMetricRangeWindow } from '@/lib/domain/monitoring/metric-range-request.ts'
import {
	parseInstantScalar,
	parseRangeQuery,
} from '@/lib/domain/monitoring/promql-response.ts'
import {
	buildVpsGaugeExprs,
	buildVpsSeriesExpr,
} from '@/lib/domain/monitoring/vps-metrics.ts'

import type { CaddyHostStat } from '@/lib/domain/monitoring/caddy-stats.ts'
import type { HostMetrics } from '@/lib/domain/monitoring/host-metrics.ts'
import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'
import type { RangePoint } from '@/lib/domain/monitoring/promql-response.ts'
import type { VpsSeriesMetric } from '@/lib/domain/monitoring/vps-metrics.ts'

/**
 * Run the four host-metric instant queries for a VPS in parallel and
 * shape them into a HostMetrics. Each gauge is independent: one failing
 * query does not blank the others - it just leaves that field null.
 */
export const loadHostMetrics = async (
	vpsName: string,
): Promise<HostMetrics> => {
	const exprs = buildHostMetricExprs(vpsName)
	const [cpuPercent, memoryPercent, diskPercent, uptimeSeconds] =
		await Promise.all([
			scalarOrNull(exprs.cpuPercent),
			scalarOrNull(exprs.memoryPercent),
			scalarOrNull(exprs.diskPercent),
			scalarOrNull(exprs.uptimeSeconds),
		])
	return { cpuPercent, memoryPercent, diskPercent, uptimeSeconds }
}

const scalarOrNull = async (expr: string): Promise<number | null> => {
	const payload = await queryVictoriaMetricsInstant(expr)
	return parseInstantScalar(payload)
}

const MS_PER_SECOND = 1000

// Window bounds for the range/log queries, mirroring the domain's metric
// window (0, 720h]. Clamp at the boundary so a NaN/negative/fractional hours
// value never reaches the LogsQL `_time:` filter or the range `step`.
const MIN_WINDOW_HOURS = 1
const MAX_WINDOW_HOURS = 720
const DEFAULT_SERIES_HOURS = 1
const DEFAULT_FLEET_LOG_HOURS = 6

const SERIES_WINDOW_BOUNDS = {
	min: MIN_WINDOW_HOURS,
	max: MAX_WINDOW_HOURS,
	fallback: DEFAULT_SERIES_HOURS,
} as const

const FLEET_LOG_WINDOW_BOUNDS = {
	min: MIN_WINDOW_HOURS,
	max: MAX_WINDOW_HOURS,
	fallback: DEFAULT_FLEET_LOG_HOURS,
} as const

export interface VpsGauges {
	readonly load1: number | null
	readonly load5: number | null
	readonly load15: number | null
	readonly swapPercent: number | null
	readonly netInMbps: number | null
	readonly netOutMbps: number | null
}

/** Instant load-average, swap and network-rate gauges for the VPS header. */
export const loadVpsGauges = async (vpsName: string): Promise<VpsGauges> => {
	const exprs = buildVpsGaugeExprs(vpsName)
	const [load1, load5, load15, swapPercent, netInMbps, netOutMbps] =
		await Promise.all([
			scalarOrNull(exprs.load1),
			scalarOrNull(exprs.load5),
			scalarOrNull(exprs.load15),
			scalarOrNull(exprs.swapPercent),
			scalarOrNull(exprs.netInMbps),
			scalarOrNull(exprs.netOutMbps),
		])
	return { load1, load5, load15, swapPercent, netInMbps, netOutMbps }
}

/** Range series for one VPS metric over the last `hours`, as chart points. */
export const loadVpsSeries = async (
	vpsName: string,
	metric: VpsSeriesMetric,
	hours: number,
): Promise<ReadonlyArray<RangePoint>> => {
	const rangeWindow = buildMetricRangeWindow(
		clampInteger(hours, SERIES_WINDOW_BOUNDS),
		Math.floor(Date.now() / MS_PER_SECOND),
	)
	const payload = await queryVictoriaMetricsRange({
		expr: buildVpsSeriesExpr(vpsName, metric),
		...rangeWindow,
	})
	return parseRangeQuery(payload)
}

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
