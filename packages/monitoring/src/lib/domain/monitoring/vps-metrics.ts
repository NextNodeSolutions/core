import { NODE_EXPORTER_EXPR } from '@/lib/domain/monitoring/node-exporter-exprs.ts'

/**
 * PromQL builders for the VPS detail screen, all scoped to a single
 * `vps_name`. The expression strings come from the shared `node-exporter-exprs`
 * table (single source); this module only selects the subset the detail screen
 * renders and maps its range control to a query window. A metric that
 * node_exporter does not expose simply returns an empty series upstream - the
 * panel renders blank, never a fabricated value.
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
const MINUTES_PER_HOUR = 60

// "Live" is a short RECENT window (the last few minutes), NOT a 1h history -
// otherwise it is indistinguishable from the 1h tab and pointless. Five minutes.
const LIVE_WINDOW_MINUTES = 5

/** Floor for any windowed query (1 minute) so a sub-hour window never rounds to 0. */
export const MIN_WINDOW_HOURS = 1 / MINUTES_PER_HOUR

const RANGE_HOURS: Readonly<Record<string, number>> = {
	live: LIVE_WINDOW_MINUTES / MINUTES_PER_HOUR,
	'1h': 1,
	'6h': 6,
	'24h': HOURS_PER_DAY,
	'7d': HOURS_PER_WEEK,
	'30d': HOURS_PER_MONTH,
}

/**
 * Map a RangeControl key (`live`/`1h`/…/`30d`) to a query window in hours. The
 * value is FRACTIONAL for `live` (5 min = 1/12 h), so every consumer must keep
 * the fraction (clamp with `clampNumber`, not `clampInteger`).
 */
export const rangeToHours = (rangeKey: string): number =>
	RANGE_HOURS[rangeKey] ?? 1

/**
 * A window (hours, possibly fractional) as a LogsQL / PromQL duration token:
 * sub-hour windows emit minutes (`5m`), whole hours emit hours (`6h`). Keeps the
 * 5-minute live window honest instead of an unreadable `_time:0.0833h`.
 */
export const windowToLogsQL = (windowHours: number): string => {
	const minutes = Math.max(1, Math.round(windowHours * MINUTES_PER_HOUR))
	return minutes % MINUTES_PER_HOUR === 0
		? `${String(minutes / MINUTES_PER_HOUR)}h`
		: `${String(minutes)}m`
}

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
