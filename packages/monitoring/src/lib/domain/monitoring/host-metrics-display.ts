import { HOST_WARN_PERCENT } from '@/lib/domain/monitoring/monitoring-thresholds.ts'

import type { Tone } from '@/lib/domain/badge-status.ts'
import type { HostMetrics } from '@/lib/domain/monitoring/host-metrics.ts'

export interface MetricDisplay {
	readonly label: string
	readonly value: string
	readonly hint: string
	readonly tone: Tone
}

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY = 86_400

const PLACEHOLDER = '-'

const PERCENT_FRACTION_DIGITS = 1

const formatPercent = (percent: number | null): string =>
	percent === null
		? PLACEHOLDER
		: `${percent.toFixed(PERCENT_FRACTION_DIGITS)}%`

const percentTone = (percent: number | null, warnAt: number): Tone => {
	if (percent === null) return 'neutral'
	if (percent >= warnAt) return 'warning'
	return 'positive'
}

const formatUptime = (seconds: number | null): string => {
	if (seconds === null || seconds < 0) return PLACEHOLDER
	if (seconds >= SECONDS_PER_DAY) {
		return `${String(Math.floor(seconds / SECONDS_PER_DAY))}d`
	}
	if (seconds >= SECONDS_PER_HOUR) {
		return `${String(Math.floor(seconds / SECONDS_PER_HOUR))}h`
	}
	return `${String(Math.floor(seconds / SECONDS_PER_MINUTE))}m`
}

/**
 * Shape the four host gauges into display rows (label, formatted value,
 * hint, tone). Pure - the component just renders the array. Null values
 * render as "-" with a neutral tone, the "not scraped yet" state.
 */
export const formatHostMetrics = (
	metrics: HostMetrics,
): ReadonlyArray<MetricDisplay> => [
	{
		label: 'CPU load',
		value: formatPercent(metrics.cpuPercent),
		hint: '5 min avg',
		tone: percentTone(metrics.cpuPercent, HOST_WARN_PERCENT.cpu),
	},
	{
		label: 'Memory',
		value: formatPercent(metrics.memoryPercent),
		hint: 'Used',
		tone: percentTone(metrics.memoryPercent, HOST_WARN_PERCENT.memory),
	},
	{
		label: 'Disk',
		value: formatPercent(metrics.diskPercent),
		hint: 'Root volume',
		tone: percentTone(metrics.diskPercent, HOST_WARN_PERCENT.disk),
	},
	{
		label: 'Uptime',
		value: formatUptime(metrics.uptimeSeconds),
		hint: 'Since boot',
		tone: 'neutral',
	},
]
