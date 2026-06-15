import { NODE_EXPORTER_EXPR } from '@/lib/domain/monitoring/node-exporter-exprs.ts'

/**
 * The four host-level gauges the VPS observability panel renders, each
 * derived from node_exporter series filtered to one `vps_name`. All are
 * nullable: a freshly-provisioned VPS, or one whose scrape just failed,
 * yields `null` and the UI shows "-".
 */
export interface HostMetrics {
	readonly cpuPercent: number | null
	readonly memoryPercent: number | null
	readonly diskPercent: number | null
	readonly uptimeSeconds: number | null
}

/**
 * Instant PromQL for each gauge, scoped to a single VPS. Cpu/memory/disk
 * reuse the canonical expressions from the shared `node-exporter-exprs`
 * table so a query tweak lands in one place; uptime is gauge-only.
 */
export const buildHostMetricExprs = (
	vpsName: string,
): Readonly<Record<keyof HostMetrics, string>> => ({
	cpuPercent: NODE_EXPORTER_EXPR.cpu(vpsName),
	memoryPercent: NODE_EXPORTER_EXPR.mem(vpsName),
	diskPercent: NODE_EXPORTER_EXPR.disk(vpsName),
	uptimeSeconds: NODE_EXPORTER_EXPR.uptime(vpsName),
})
