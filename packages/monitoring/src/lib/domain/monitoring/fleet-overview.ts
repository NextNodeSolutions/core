import {
	formatCount,
	formatPercent,
	formatTrafficGb,
} from '@/lib/domain/monitoring/format.ts'

import type { Tone } from '@/lib/domain/badge-status.ts'
import type { HetznerVps, VpsStatus } from '@/lib/domain/hetzner/vps.ts'

/**
 * Overview aggregations for the fleet dashboard.
 *
 * Pure: callers pass the real Hetzner inventory, the VictoriaMetrics host
 * gauges keyed by server name, and the VictoriaLogs error count. Alerts are
 * derived from the live metric thresholds, not from a synthetic source.
 */

const WARNING_PERCENT = 75
const CRITICAL_PERCENT = 90
const BYTES_PER_GB = 1_000_000_000
const EMPTY_VALUE = '-'

export interface ServerMetrics {
	readonly cpuPercent: number | null
	readonly memoryPercent: number | null
	readonly diskPercent: number | null
}

export type FleetHealth = 'running' | 'warning' | 'critical' | 'down'

export type AlertMetric = 'cpu' | 'memory' | 'disk'

export interface DerivedAlert {
	readonly vpsName: string
	readonly metric: AlertMetric
	readonly severity: 'warning' | 'critical'
	readonly valuePercent: number
	readonly thresholdPercent: number
	readonly label: string
}

export interface FleetStat {
	readonly label: string
	readonly value: string
	readonly hint: string
	readonly tone: Tone
}

export interface FleetSummaryInput {
	readonly servers: ReadonlyArray<HetznerVps>
	readonly metricsByName: Readonly<Record<string, ServerMetrics>>
	readonly errorCount: number
}

const ALERT_METRICS: AlertMetric[] = ['cpu', 'memory', 'disk']

const METRIC_LABELS: Record<AlertMetric, string> = {
	cpu: 'CPU',
	memory: 'Mémoire',
	disk: 'Disque',
}

function metricValue(
	metrics: ServerMetrics,
	metric: AlertMetric,
): number | null {
	if (metric === 'cpu') return metrics.cpuPercent
	if (metric === 'memory') return metrics.memoryPercent
	return metrics.diskPercent
}

function worstLoad(metrics: ServerMetrics): number {
	return Math.max(
		metrics.cpuPercent ?? 0,
		metrics.memoryPercent ?? 0,
		metrics.diskPercent ?? 0,
	)
}

export function computeServerHealth(
	status: VpsStatus,
	metrics: ServerMetrics,
): FleetHealth {
	if (status !== 'running') return 'down'
	const worst = worstLoad(metrics)
	if (worst >= CRITICAL_PERCENT) return 'critical'
	if (worst >= WARNING_PERCENT) return 'warning'
	return 'running'
}

function evaluateMetricAlert(
	vpsName: string,
	metrics: ServerMetrics,
	metric: AlertMetric,
): DerivedAlert | null {
	const percent = metricValue(metrics, metric)
	if (percent === null || percent < WARNING_PERCENT) return null
	const critical = percent >= CRITICAL_PERCENT
	return {
		vpsName,
		metric,
		severity: critical ? 'critical' : 'warning',
		valuePercent: percent,
		thresholdPercent: critical ? CRITICAL_PERCENT : WARNING_PERCENT,
		label: `${METRIC_LABELS[metric]} à ${formatPercent(percent)}`,
	}
}

function collectServerAlerts(
	server: HetznerVps,
	metrics: ServerMetrics | undefined,
): DerivedAlert[] {
	if (server.status !== 'running' || metrics === undefined) return []
	return ALERT_METRICS.map(metric =>
		evaluateMetricAlert(server.name, metrics, metric),
	).filter((alert): alert is DerivedAlert => alert !== null)
}

export function deriveFleetAlerts(
	servers: ReadonlyArray<HetznerVps>,
	metricsByName: Readonly<Record<string, ServerMetrics>>,
): DerivedAlert[] {
	return servers.flatMap(server =>
		collectServerAlerts(server, metricsByName[server.name]),
	)
}

function activeStat(servers: ReadonlyArray<HetznerVps>): FleetStat {
	const total = servers.length
	const running = servers.filter(server => server.status === 'running').length
	const allUp = running === total
	return {
		label: 'VPS actifs',
		value: `${running}/${total}`,
		hint: allUp ? 'Tous opérationnels' : `${total - running} hors service`,
		tone: allUp ? 'positive' : 'warning',
	}
}

function cpuStat(input: FleetSummaryInput): FleetStat {
	const samples = input.servers
		.map(server => input.metricsByName[server.name]?.cpuPercent ?? null)
		.filter((percent): percent is number => percent !== null)
	if (samples.length === 0) {
		return {
			label: 'CPU moyen fleet',
			value: EMPTY_VALUE,
			hint: 'aucune métrique',
			tone: 'neutral',
		}
	}
	const average =
		samples.reduce((sum, percent) => sum + percent, 0) / samples.length
	const tone: Tone =
		average >= CRITICAL_PERCENT
			? 'danger'
			: average >= WARNING_PERCENT
				? 'warning'
				: 'neutral'
	return {
		label: 'CPU moyen fleet',
		value: formatPercent(average),
		hint: `${samples.length} nœud${samples.length > 1 ? 's' : ''}`,
		tone,
	}
}

function trafficStat(servers: ReadonlyArray<HetznerVps>): FleetStat {
	const outgoingGb =
		servers.reduce((sum, server) => sum + server.traffic.outgoingBytes, 0) /
		BYTES_PER_GB
	const includedGb =
		servers.reduce((sum, server) => sum + server.traffic.includedBytes, 0) /
		BYTES_PER_GB
	return {
		label: 'Trafic sortant (mois)',
		value: formatTrafficGb(outgoingGb),
		hint: `sur ${formatTrafficGb(includedGb)} inclus`,
		tone: 'neutral',
	}
}

function errorStat(input: FleetSummaryInput): FleetStat {
	const alertCount = deriveFleetAlerts(
		input.servers,
		input.metricsByName,
	).length
	return {
		label: 'Erreurs (6 h)',
		value: formatCount(input.errorCount),
		hint: `${alertCount} alerte${alertCount > 1 ? 's' : ''}`,
		tone: input.errorCount > 0 ? 'danger' : 'positive',
	}
}

export function summarizeFleet(input: FleetSummaryInput): FleetStat[] {
	return [
		activeStat(input.servers),
		cpuStat(input),
		trafficStat(input.servers),
		errorStat(input),
	]
}
