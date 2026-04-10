import type { MonitoringSloConfig } from '@nextnode-solutions/infrastructure/config/schema'

/**
 * Google SRE workbook multi-window multi-burn-rate alerting windows.
 *
 * Each entry is one alerting pair (long+short window) with a burn-rate
 * multiplier relative to the SLO error budget. An alert fires when BOTH
 * the long and short windows exceed the multiplier times the baseline
 * error ratio simultaneously — this keeps fast alerts responsive while
 * avoiding flapping on transient blips.
 *
 * See https://sre.google/workbook/alerting-on-slos (table 5-7).
 */
export interface BurnRateWindow {
	readonly multiplier: number
	readonly longWindow: string
	readonly shortWindow: string
	readonly severity: 'page' | 'ticket'
}

export const SRE_BURN_RATE_WINDOWS: ReadonlyArray<BurnRateWindow> = [
	// Fast burn — 2% of 30d budget burned in 1h. Wake someone up.
	{
		multiplier: 14.4,
		longWindow: '1h',
		shortWindow: '5m',
		severity: 'page',
	},
	// Medium burn — 5% of 30d budget burned in 6h. Page during business hours.
	{
		multiplier: 6,
		longWindow: '6h',
		shortWindow: '30m',
		severity: 'page',
	},
	// Slow burn — 10% of 30d budget burned in 3d. Open a ticket.
	{
		multiplier: 1,
		longWindow: '3d',
		shortWindow: '6h',
		severity: 'ticket',
	},
]

const MINUTES_PER_DAY = 1440
const PERCENT_TO_RATIO = 100

/**
 * Baseline error ratio allowed by the SLO.
 *
 * Example: `availability = 99.9` → `0.001` (0.1%).
 */
export function computeBaselineErrorRatio(slo: MonitoringSloConfig): number {
	return (PERCENT_TO_RATIO - slo.availability) / PERCENT_TO_RATIO
}

/**
 * Total minutes of unavailability allowed in the SLO's rolling window.
 *
 * Example: `availability = 99.9`, `windowDays = 30`
 * → `30 * 24 * 60 * 0.001 = 43.2` minutes
 */
export function computeErrorBudgetMinutes(slo: MonitoringSloConfig): number {
	const baselineErrorRatio = computeBaselineErrorRatio(slo)
	return slo.windowDays * MINUTES_PER_DAY * baselineErrorRatio
}

export interface BurnRateThreshold {
	readonly severity: 'page' | 'ticket'
	readonly longWindow: string
	readonly shortWindow: string
	readonly multiplier: number
	readonly errorRatio: number
}

/**
 * Absolute error-ratio thresholds derived from an SLO, one per SRE window.
 *
 * These feed the vmalert rule generator in Step 6: each threshold becomes an
 * `rate(http_errors_total[window]) / rate(http_requests_total[window]) > errorRatio`
 * PromQL expression.
 */
export function computeBurnRateThresholds(
	slo: MonitoringSloConfig,
): ReadonlyArray<BurnRateThreshold> {
	const baselineErrorRatio = computeBaselineErrorRatio(slo)
	return SRE_BURN_RATE_WINDOWS.map(window => ({
		severity: window.severity,
		longWindow: window.longWindow,
		shortWindow: window.shortWindow,
		multiplier: window.multiplier,
		errorRatio: window.multiplier * baselineErrorRatio,
	}))
}
