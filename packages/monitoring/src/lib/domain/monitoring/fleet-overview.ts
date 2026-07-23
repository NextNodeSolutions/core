import {
	EMPTY_LABEL,
	formatCount,
	formatPercent,
	formatTrafficGb,
} from '@/lib/domain/monitoring/format.ts'
import {
	FLEET_CRITICAL_PERCENT,
	FLEET_WARN_PERCENT,
	severityForPercent,
} from '@/lib/domain/monitoring/monitoring-thresholds.ts'

import type { Tone } from '@/lib/domain/badge-status.ts'
import type { FleetVps } from '@/lib/domain/monitoring/fleet-vps.ts'
import type { TrafficTotals } from '@/lib/domain/monitoring/host-facts.ts'

/**
 * Overview aggregations for the fleet dashboard.
 *
 * Pure: callers pass the metrics-discovered fleet, the VictoriaMetrics
 * host gauges keyed by server name, and the VictoriaLogs error count.
 * Alerts are derived from the live metric thresholds, not from a
 * synthetic source.
 */

const BYTES_PER_GB = 1_000_000_000

export interface ServerMetrics {
	readonly cpuPercent: number | null
	readonly memoryPercent: number | null
	readonly diskPercent: number | null
}

export type FleetHealth =
	| 'running'
	| 'warning'
	| 'critical'
	| 'down'
	| 'unknown'

export type AlertMetric = 'cpu' | 'memory' | 'disk'

export interface DerivedAlert {
	readonly vpsName: string
	readonly metric: AlertMetric
	readonly severity: 'warning' | 'critical'
	readonly valuePercent: number
	readonly thresholdPercent: number
	readonly label: string
}

/**
 * Semantic glyph a stat is rendered with. The domain owns this (alongside the
 * label/value/tone it already emits) so the island renders icon-by-stat instead
 * of mapping icons positionally against `summarizeFleet`'s output order - the
 * stat carries its own identity, order changes can't desync the icons.
 */
export type FleetStatIcon = 'server' | 'cpu' | 'net' | 'alert'

export interface FleetStat {
	readonly label: string
	readonly value: string
	readonly hint: string
	readonly tone: Tone
	readonly icon: FleetStatIcon
}

export interface FleetSummaryInput {
	readonly servers: ReadonlyArray<FleetVps>
	readonly metricsByName: Readonly<Record<string, ServerMetrics>>
	readonly errorCount: number
	/** Fleet-wide network totals over the window (null fields render "-"). */
	readonly traffic: TrafficTotals
	/** Selected time window in hours - labels the windowed stats honestly. */
	readonly windowHours: number
	/**
	 * Mean CPU% across the fleet OVER the window (not the instant snapshot), or
	 * null when no server reported a single sample for the window. Computed from
	 * the same range series the fleet sparklines use - see `fleetCpuWindowAverage`.
	 */
	readonly cpuWindowAverage: number | null
	/** How many servers contributed at least one CPU sample to the average. */
	readonly cpuNodeCount: number
}

const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

/**
 * The honest label for a windowed stat: `6` -> `6 h`, a sub-hour live
 * window -> `5 min` (never `0.0833 h`), and a multi-day window -> `7 j`
 * (never `168 h`). `24` stays `24 h` to match the range control's tab.
 */
const windowLabel = (windowHours: number): string => {
	if (windowHours < 1) {
		return `${String(Math.round(windowHours * MINUTES_PER_HOUR))} min`
	}
	if (windowHours > HOURS_PER_DAY && windowHours % HOURS_PER_DAY === 0) {
		return `${String(windowHours / HOURS_PER_DAY)} j`
	}
	return `${String(windowHours)} h`
}

const ALERT_METRICS: AlertMetric[] = ['cpu', 'memory', 'disk']

const METRIC_LABELS: Record<AlertMetric, string> = {
	cpu: 'CPU',
	memory: 'Mémoire',
	disk: 'Disque',
}

const METRIC_FIELD: Record<AlertMetric, keyof ServerMetrics> = {
	cpu: 'cpuPercent',
	memory: 'memoryPercent',
	disk: 'diskPercent',
}

function metricValue(
	metrics: ServerMetrics,
	metric: AlertMetric,
): number | null {
	return metrics[METRIC_FIELD[metric]]
}

function worstLoad(metrics: ServerMetrics): number {
	return Math.max(
		metrics.cpuPercent ?? 0,
		metrics.memoryPercent ?? 0,
		metrics.diskPercent ?? 0,
	)
}

function hasAnyMetric(metrics: ServerMetrics): boolean {
	return (
		metrics.cpuPercent !== null ||
		metrics.memoryPercent !== null ||
		metrics.diskPercent !== null
	)
}

export function computeServerHealth(
	isOnline: boolean,
	metrics: ServerMetrics,
): FleetHealth {
	if (!isOnline) return 'down'
	// An online VPS with no metric at all is a missing scrape, not a healthy
	// idle host - treating absent metrics as 0 would mask the gap.
	if (!hasAnyMetric(metrics)) return 'unknown'
	const severity = severityForPercent(worstLoad(metrics))
	if (severity === 'critical') return 'critical'
	if (severity === 'warning') return 'warning'
	return 'running'
}

function evaluateMetricAlert(
	vpsName: string,
	metrics: ServerMetrics,
	metric: AlertMetric,
): DerivedAlert | null {
	const percent = metricValue(metrics, metric)
	if (percent === null) return null
	const severity = severityForPercent(percent)
	if (severity === 'ok') return null
	const critical = severity === 'critical'
	return {
		vpsName,
		metric,
		severity: critical ? 'critical' : 'warning',
		valuePercent: percent,
		thresholdPercent: critical
			? FLEET_CRITICAL_PERCENT
			: FLEET_WARN_PERCENT,
		label: `${METRIC_LABELS[metric]} à ${formatPercent(percent)}`,
	}
}

function collectServerAlerts(
	server: FleetVps,
	metrics: ServerMetrics | undefined,
): DerivedAlert[] {
	if (!server.isOnline || !metrics) return []
	return ALERT_METRICS.map(metric =>
		evaluateMetricAlert(server.name, metrics, metric),
	).filter((alert): alert is DerivedAlert => alert !== null)
}

export function deriveFleetAlerts(
	servers: ReadonlyArray<FleetVps>,
	metricsByName: Readonly<Record<string, ServerMetrics>>,
): DerivedAlert[] {
	return servers.flatMap(server =>
		collectServerAlerts(server, metricsByName[server.name]),
	)
}

function activeStat(servers: ReadonlyArray<FleetVps>): FleetStat {
	const total = servers.length
	// An empty fleet is a discovery gap (the query succeeded but returned no
	// series), never "all good" - 0/0 must not render as a green success.
	if (total === 0) {
		return {
			label: 'VPS actifs',
			value: '0/0',
			hint: 'aucun VPS découvert',
			tone: 'warning',
			icon: 'server',
		}
	}
	const onlineCount = servers.filter(server => server.isOnline).length
	const allUp = onlineCount === total
	return {
		label: 'VPS actifs',
		value: `${onlineCount}/${total}`,
		hint: allUp
			? 'Tous opérationnels'
			: `${total - onlineCount} hors ligne`,
		tone: allUp ? 'positive' : 'warning',
		icon: 'server',
	}
}

/**
 * Mean CPU% across the fleet over the window: the mean of each server's own
 * series mean, so a chatty host with more samples does not outweigh a quiet
 * one. A server with no samples contributes nothing; all-empty -> null.
 */
export function fleetCpuWindowAverage(
	cpuSeriesByServer: ReadonlyArray<ReadonlyArray<number>>,
): { average: number | null; nodeCount: number } {
	const perServerMeans = cpuSeriesByServer
		.filter(series => series.length > 0)
		.map(series => series.reduce((sum, v) => sum + v, 0) / series.length)
	if (!perServerMeans.length) return { average: null, nodeCount: 0 }
	const average =
		perServerMeans.reduce((sum, mean) => sum + mean, 0) /
		perServerMeans.length
	return { average, nodeCount: perServerMeans.length }
}

function cpuStat(input: FleetSummaryInput): FleetStat {
	const label = `CPU moyen (${windowLabel(input.windowHours)})`
	if (input.cpuWindowAverage === null) {
		return {
			label,
			value: EMPTY_LABEL,
			hint: 'aucune métrique',
			tone: 'neutral',
			icon: 'cpu',
		}
	}
	const severity = severityForPercent(input.cpuWindowAverage)
	const tone: Tone =
		severity === 'critical'
			? 'danger'
			: severity === 'warning'
				? 'warning'
				: 'neutral'
	return {
		label,
		value: formatPercent(input.cpuWindowAverage),
		hint: `${input.cpuNodeCount} nœud${input.cpuNodeCount > 1 ? 's' : ''}`,
		tone,
		icon: 'cpu',
	}
}

function trafficStat(input: FleetSummaryInput): FleetStat {
	const { inBytes, outBytes } = input.traffic
	return {
		label: `Trafic sortant (${windowLabel(input.windowHours)})`,
		value:
			outBytes === null
				? EMPTY_LABEL
				: formatTrafficGb(outBytes / BYTES_PER_GB),
		hint:
			inBytes === null
				? 'entrant inconnu'
				: `↓ ${formatTrafficGb(inBytes / BYTES_PER_GB)} entrant`,
		tone: 'neutral',
		icon: 'net',
	}
}

function errorStat(input: FleetSummaryInput): FleetStat {
	const alertCount = deriveFleetAlerts(
		input.servers,
		input.metricsByName,
	).length
	return {
		label: `Erreurs (${windowLabel(input.windowHours)})`,
		value: formatCount(input.errorCount),
		hint: `${alertCount} alerte${alertCount > 1 ? 's' : ''}`,
		tone: input.errorCount > 0 ? 'danger' : 'positive',
		icon: 'alert',
	}
}

export function summarizeFleet(input: FleetSummaryInput): FleetStat[] {
	return [
		activeStat(input.servers),
		cpuStat(input),
		trafficStat(input),
		errorStat(input),
	]
}
