import type { VpsSeriesMetric } from '@/lib/domain/monitoring/vps-metrics.ts'

/**
 * Single source for the fleet-comparison metric set: the tab options, the
 * unit suffix and the percent flag. Ported verbatim from VpsMetrics.astro's
 * `CMP_METRICS` / `cmpUnit` / `cmpIsPercent` so the island and the API share
 * one definition - the API validates incoming `metric` against `isCmpMetric`
 * and the tabs render from `CMP_METRIC_OPTIONS`.
 */

export type CmpMetric = Extract<
	VpsSeriesMetric,
	'cpu' | 'mem' | 'load' | 'netOut'
>

export const DEFAULT_CMP_METRIC: CmpMetric = 'cpu'

export interface CmpMetricOption {
	readonly key: CmpMetric
	readonly label: string
}

export const CMP_METRIC_OPTIONS: ReadonlyArray<CmpMetricOption> = [
	{ key: 'cpu', label: 'CPU' },
	{ key: 'mem', label: 'Mémoire' },
	{ key: 'load', label: 'Load' },
	{ key: 'netOut', label: 'Net out' },
]

export const isCmpMetric = (candidate: string): candidate is CmpMetric =>
	candidate === 'cpu' ||
	candidate === 'mem' ||
	candidate === 'load' ||
	candidate === 'netOut'

/** Axis unit suffix for a comparison metric (percent, load is unitless). */
export const cmpUnit = (metric: CmpMetric): string => {
	if (metric === 'load') return ''
	if (metric === 'netOut') return ' Mb/s'
	return '%'
}

/** Percent metrics pin the chart axis to 100; the others auto-scale. */
export const cmpIsPercent = (metric: CmpMetric): boolean =>
	metric === 'cpu' || metric === 'mem'
