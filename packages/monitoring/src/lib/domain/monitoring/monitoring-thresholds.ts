/**
 * Single source of the percentage thresholds that drive gauge colours and
 * fleet alerts. Every gauge, fleet card and alert derives its band from here
 * so the numbers never drift apart.
 */

/** Fleet-wide severity bands: overview alerts and gauge/bar/arc colours. */
export const FLEET_WARN_PERCENT = 75
export const FLEET_CRITICAL_PERCENT = 90

/**
 * Host-detail gauge tone warns later than the fleet bands on purpose: a
 * single VPS legitimately runs hot before it pages, and disk tolerates more
 * headroom. Two-band (warn-only) by design - the detail view has no critical
 * colour.
 */
export const HOST_WARN_PERCENT: Readonly<
	Record<'cpu' | 'memory' | 'disk', number>
> = {
	cpu: 90,
	memory: 90,
	disk: 85,
}

export type MetricSeverity = 'ok' | 'warning' | 'critical'

/** Classify a 0-100 percentage into its fleet severity band. */
export function severityForPercent(percent: number): MetricSeverity {
	if (percent >= FLEET_CRITICAL_PERCENT) return 'critical'
	if (percent >= FLEET_WARN_PERCENT) return 'warning'
	return 'ok'
}
