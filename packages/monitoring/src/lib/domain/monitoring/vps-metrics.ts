import type { RangePoint } from '@/lib/domain/monitoring/promql-response.ts'

/**
 * PromQL builders + summaries for the VPS detail screen, all scoped to a
 * single `vps_name` and derived from node_exporter series. Pure: the adapter
 * runs the queries, this only shapes the expressions and the value summary.
 * A metric that node_exporter does not expose simply returns an empty series
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

const RATE_WINDOW = '5m'

const selector = (vpsName: string): string => `vps_name="${vpsName}"`

const SERIES_EXPR: Record<VpsSeriesMetric, (vpsName: string) => string> = {
	cpu: vps =>
		`100 - (avg(rate(node_cpu_seconds_total{${selector(vps)},mode="idle"}[${RATE_WINDOW}])) * 100)`,
	mem: vps =>
		`100 * (1 - node_memory_MemAvailable_bytes{${selector(vps)}} / node_memory_MemTotal_bytes{${selector(vps)}})`,
	disk: vps =>
		`100 * (1 - node_filesystem_avail_bytes{${selector(vps)},mountpoint="/",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{${selector(vps)},mountpoint="/",fstype!~"tmpfs|overlay"})`,
	netIn: vps =>
		`sum(rate(node_network_receive_bytes_total{${selector(vps)},device!~"lo"}[${RATE_WINDOW}])) * 8 / 1e6`,
	netOut: vps =>
		`sum(rate(node_network_transmit_bytes_total{${selector(vps)},device!~"lo"}[${RATE_WINDOW}])) * 8 / 1e6`,
	diskIo: vps =>
		`sum(rate(node_disk_written_bytes_total{${selector(vps)}}[${RATE_WINDOW}])) / 1e6`,
	diskLatency: vps =>
		`sum(rate(node_disk_io_time_seconds_total{${selector(vps)}}[${RATE_WINDOW}])) * 1000`,
	load: vps => `node_load1{${selector(vps)}}`,
}

export const buildVpsSeriesExpr = (
	vpsName: string,
	metric: VpsSeriesMetric,
): string => SERIES_EXPR[metric](vpsName)

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
	load1: `node_load1{${selector(vpsName)}}`,
	load5: `node_load5{${selector(vpsName)}}`,
	load15: `node_load15{${selector(vpsName)}}`,
	swapPercent: `100 * (1 - node_memory_SwapFree_bytes{${selector(vpsName)}} / node_memory_SwapTotal_bytes{${selector(vpsName)}})`,
	netInMbps: SERIES_EXPR.netIn(vpsName),
	netOutMbps: SERIES_EXPR.netOut(vpsName),
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
