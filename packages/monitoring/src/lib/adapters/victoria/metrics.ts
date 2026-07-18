import {
	MOCK_DATA,
	mockHostMetrics,
	mockVpsGauges,
	mockVpsSeries,
} from '@/lib/adapters/mock-data.ts'
import {
	queryVictoriaMetricsInstant,
	queryVictoriaMetricsRange,
} from '@/lib/adapters/victoria/client.ts'
import { clampNumber } from '@/lib/domain/clamp.ts'
import { buildHostMetricExprs } from '@/lib/domain/monitoring/host-metrics.ts'
import { buildMetricRangeWindow } from '@/lib/domain/monitoring/metric-range-request.ts'
import {
	parseInstantScalar,
	parseRangeQuery,
} from '@/lib/domain/monitoring/promql-response.ts'
import {
	buildVpsGaugeExprs,
	buildVpsSeriesExpr,
	MIN_WINDOW_HOURS,
} from '@/lib/domain/monitoring/vps-metrics.ts'

import type { HostMetrics } from '@/lib/domain/monitoring/host-metrics.ts'
import type { RangePoint } from '@/lib/domain/monitoring/promql-response.ts'
import type { VpsSeriesMetric } from '@/lib/domain/monitoring/vps-metrics.ts'

/**
 * VictoriaMetrics adapter: host gauges, the VPS header gauges, and per-metric
 * range series. Each loader builds the PromQL in domain, runs the query, and
 * parses the response back to a domain shape - no business decisions here.
 */

const MS_PER_SECOND = 1000

// Window bounds for the range queries, mirroring the domain's metric window
// (0, 720h]. `min` is one minute (not 1h) so the live 5-minute window survives;
// `clampNumber` keeps the fraction. Guards NaN/negative/over-max at the boundary.
const SERIES_WINDOW_BOUNDS = {
	min: MIN_WINDOW_HOURS,
	max: 720,
	fallback: 1,
} as const

/** One instant query reduced to its scalar - shared by the sibling adapters. */
export const scalarOrNull = async (expr: string): Promise<number | null> => {
	const payload = await queryVictoriaMetricsInstant(expr)
	return parseInstantScalar(payload)
}

/**
 * Run the four host-metric instant queries for a VPS in parallel and shape
 * them into a HostMetrics. Each gauge is independent: one failing query does
 * not blank the others - it just leaves that field null.
 */
export const loadHostMetrics = async (
	vpsName: string,
): Promise<HostMetrics> => {
	if (MOCK_DATA) return mockHostMetrics(vpsName)
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
	if (MOCK_DATA) return mockVpsGauges(vpsName)
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
	if (MOCK_DATA) return mockVpsSeries(vpsName, metric, hours)
	const rangeWindow = buildMetricRangeWindow(
		clampNumber(hours, SERIES_WINDOW_BOUNDS),
		Math.floor(Date.now() / MS_PER_SECOND),
	)
	const payload = await queryVictoriaMetricsRange({
		expr: buildVpsSeriesExpr(vpsName, metric),
		...rangeWindow,
	})
	return parseRangeQuery(payload)
}
