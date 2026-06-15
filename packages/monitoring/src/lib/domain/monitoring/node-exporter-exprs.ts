/**
 * Single source of the node_exporter PromQL expressions used across the
 * monitoring package. Both the VPS detail series (`vps-metrics.ts`) and the
 * host gauges (`host-metrics.ts`) derive their queries from this table, so a
 * tweak to the cpu/mem/disk math lands in exactly one place. Pure string
 * construction - the adapter performs the IO.
 *
 * Quoting: JSON.stringify yields a double-quoted, backslash/quote-escaped
 * string - exactly what a PromQL label matcher needs - so a vps_name carrying
 * `"` or `\` cannot break out of the selector.
 */

/** Rate window applied to every node_exporter `rate()` expression. */
export const RATE_WINDOW = '5m'

const selector = (vpsName: string): string =>
	`vps_name=${JSON.stringify(vpsName)}`

export const NODE_EXPORTER_METRICS = [
	'cpu',
	'mem',
	'disk',
	'uptime',
	'netIn',
	'netOut',
	'diskIo',
	'diskLatency',
	'load',
	'load1',
	'load5',
	'load15',
	'swap',
] as const

export type NodeExporterMetric = (typeof NODE_EXPORTER_METRICS)[number]

/**
 * `vps_name` → instant/series PromQL, one entry per node_exporter metric.
 * Percentages are 0-100; uptime is seconds; network is Mb/s; disk IO is MB/s.
 */
export const NODE_EXPORTER_EXPR: Record<
	NodeExporterMetric,
	(vpsName: string) => string
> = {
	cpu: vps =>
		`100 - (avg(rate(node_cpu_seconds_total{${selector(vps)},mode="idle"}[${RATE_WINDOW}])) * 100)`,
	mem: vps =>
		`100 * (1 - node_memory_MemAvailable_bytes{${selector(vps)}} / node_memory_MemTotal_bytes{${selector(vps)}})`,
	disk: vps =>
		`100 * (1 - node_filesystem_avail_bytes{${selector(vps)},mountpoint="/",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{${selector(vps)},mountpoint="/",fstype!~"tmpfs|overlay"})`,
	uptime: vps => `time() - node_boot_time_seconds{${selector(vps)}}`,
	netIn: vps =>
		`sum(rate(node_network_receive_bytes_total{${selector(vps)},device!~"lo"}[${RATE_WINDOW}])) * 8 / 1e6`,
	netOut: vps =>
		`sum(rate(node_network_transmit_bytes_total{${selector(vps)},device!~"lo"}[${RATE_WINDOW}])) * 8 / 1e6`,
	diskIo: vps =>
		`sum(rate(node_disk_written_bytes_total{${selector(vps)}}[${RATE_WINDOW}])) / 1e6`,
	diskLatency: vps =>
		`sum(rate(node_disk_io_time_seconds_total{${selector(vps)}}[${RATE_WINDOW}])) * 1000`,
	load: vps => `node_load1{${selector(vps)}}`,
	load1: vps => `node_load1{${selector(vps)}}`,
	load5: vps => `node_load5{${selector(vps)}}`,
	load15: vps => `node_load15{${selector(vps)}}`,
	swap: vps =>
		`100 * (1 - node_memory_SwapFree_bytes{${selector(vps)}} / node_memory_SwapTotal_bytes{${selector(vps)}})`,
}
