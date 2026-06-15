import { NODE_EXPORTER_EXPR } from '@/lib/domain/monitoring/node-exporter-exprs.ts'

import type { RangePoint } from '@/lib/domain/monitoring/promql-response.ts'

/**
 * PromQL builders + summaries for the VPS detail screen, all scoped to a
 * single `vps_name`. The expression strings come from the shared
 * `node-exporter-exprs` table (single source); this module only selects the
 * subset the detail screen renders and summarises the sampled values. A
 * metric that node_exporter does not expose simply returns an empty series
 * upstream - the panel renders blank, never a fabricated value.
 */

export const VPS_SERIES_METRICS = [
	'cpu',
	'mem',
	'disk',
	'netIn',
	'netOut',
	'diskIo',
	'diskLatency',
	'load',
] as const

export type VpsSeriesMetric = (typeof VPS_SERIES_METRICS)[number]

export const buildVpsSeriesExpr = (
	vpsName: string,
	metric: VpsSeriesMetric,
): string => NODE_EXPORTER_EXPR[metric](vpsName)

const HOURS_PER_DAY = 24
const HOURS_PER_WEEK = 168
const HOURS_PER_MONTH = 720

const RANGE_HOURS: Readonly<Record<string, number>> = {
	live: 1,
	'1h': 1,
	'6h': 6,
	'24h': HOURS_PER_DAY,
	'7d': HOURS_PER_WEEK,
	'30d': HOURS_PER_MONTH,
}

/** Map a RangeControl key (`live`/`1h`/…/`30d`) to a query window in hours. */
export const rangeToHours = (rangeKey: string): number =>
	RANGE_HOURS[rangeKey] ?? 1

export interface VpsGaugeExprs {
	readonly load1: string
	readonly load5: string
	readonly load15: string
	readonly swapPercent: string
	readonly netInMbps: string
	readonly netOutMbps: string
}

export const buildVpsGaugeExprs = (vpsName: string): VpsGaugeExprs => ({
	load1: NODE_EXPORTER_EXPR.load1(vpsName),
	load5: NODE_EXPORTER_EXPR.load5(vpsName),
	load15: NODE_EXPORTER_EXPR.load15(vpsName),
	swapPercent: NODE_EXPORTER_EXPR.swap(vpsName),
	netInMbps: NODE_EXPORTER_EXPR.netIn(vpsName),
	netOutMbps: NODE_EXPORTER_EXPR.netOut(vpsName),
})

export interface SeriesSummary {
	readonly average: number | null
	readonly peak: number | null
}

export const summarizeSeries = (
	points: ReadonlyArray<RangePoint>,
): SeriesSummary => {
	if (points.length === 0) return { average: null, peak: null }
	const values = points.map(point => point.v)
	const total = values.reduce((sum, sample) => sum + sample, 0)
	return { average: total / values.length, peak: Math.max(...values) }
}
