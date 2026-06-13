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
 * Instant PromQL for each gauge, scoped to a single VPS. The vps_name is
 * injected as a label matcher; values are percentages (0-100) except
 * uptime (seconds). Quoting: vps_name comes from the Hetzner server name
 * (kebab identifier), so it carries no quote/backslash to escape - but we
 * still pin it inside a `=""` matcher so an unexpected value cannot break
 * out of the selector.
 */
export const buildHostMetricExprs = (
	vpsName: string,
): Readonly<Record<keyof HostMetrics, string>> => {
	const vps = `vps_name="${vpsName}"`
	return {
		cpuPercent: `100 - (avg(rate(node_cpu_seconds_total{${vps},mode="idle"}[5m])) * 100)`,
		memoryPercent: `100 * (1 - node_memory_MemAvailable_bytes{${vps}} / node_memory_MemTotal_bytes{${vps}})`,
		diskPercent: `100 * (1 - node_filesystem_avail_bytes{${vps},mountpoint="/",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{${vps},mountpoint="/",fstype!~"tmpfs|overlay"})`,
		uptimeSeconds: `time() - node_boot_time_seconds{${vps}}`,
	}
}
