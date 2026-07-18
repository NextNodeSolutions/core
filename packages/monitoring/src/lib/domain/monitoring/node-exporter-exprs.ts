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
	'cores',
	'memoryTotalBytes',
	'diskTotalBytes',
] as const

export type NodeExporterMetric = (typeof NODE_EXPORTER_METRICS)[number]

export type TrafficDirection = 'in' | 'out'

/** Network byte counters, shared by the rate gauges and the windowed totals. */
const NET_COUNTER: Record<TrafficDirection, string> = {
	in: 'node_network_receive_bytes_total',
	out: 'node_network_transmit_bytes_total',
}

/** Loopback-only exclusion for the instantaneous rate gauges. */
const RATE_DEVICE_FILTER = 'device!~"lo"'

/**
 * Physical-NIC-only filter for the windowed byte totals: virtual interfaces
 * (docker bridge, veth pairs, tailnet) re-carry the same bytes the physical
 * NIC already counts, so summing them would double or triple the totals.
 */
const TRAFFIC_DEVICE_FILTER = 'device!~"lo|docker.*|veth.*|br-.*|tailscale.*"'

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
		`sum(rate(${NET_COUNTER.in}{${selector(vps)},${RATE_DEVICE_FILTER}}[${RATE_WINDOW}])) * 8 / 1e6`,
	netOut: vps =>
		`sum(rate(${NET_COUNTER.out}{${selector(vps)},${RATE_DEVICE_FILTER}}[${RATE_WINDOW}])) * 8 / 1e6`,
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
	cores: vps =>
		`count(count by (cpu) (node_cpu_seconds_total{${selector(vps)},mode="idle"}))`,
	// `max()` collapses the row to one series: during an SD address change two
	// instances briefly coexist for one vps_name, and `parseInstantScalar`
	// expects a single-series result.
	memoryTotalBytes: vps =>
		`max(node_memory_MemTotal_bytes{${selector(vps)}})`,
	diskTotalBytes: vps =>
		`max(node_filesystem_size_bytes{${selector(vps)},mountpoint="/",fstype!~"tmpfs|overlay"})`,
}

const SECONDS_PER_HOUR = 3600

/**
 * Total bytes transferred over the last `windowHours`, from the network
 * counters of the physical NIC only (see TRAFFIC_DEVICE_FILTER). `vpsName`
 * scopes to one VPS; `null` sums the whole fleet (`vps_name!=""` keeps only
 * client-VPS series - the blackbox/backups jobs carry no `vps_name`).
 */
export const buildTrafficTotalExpr = (
	vpsName: string | null,
	direction: TrafficDirection,
	windowHours: number,
): string => {
	const scope = vpsName === null ? 'vps_name!=""' : selector(vpsName)
	// Integer seconds: the sub-hour live window would otherwise render a
	// fractional duration, which classic PromQL rejects.
	const window = `${String(Math.round(windowHours * SECONDS_PER_HOUR))}s`
	return `sum(increase(${NET_COUNTER[direction]}{${scope},${TRAFFIC_DEVICE_FILTER}}[${window}]))`
}
