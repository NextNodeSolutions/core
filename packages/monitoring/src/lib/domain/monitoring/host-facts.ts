import { NODE_EXPORTER_EXPR } from '@/lib/domain/monitoring/node-exporter-exprs.ts'

/**
 * Static hardware facts of a VPS, read from node_exporter instead of a
 * cloud-provider inventory API - the fleet stays provider-agnostic. All
 * nullable: a VPS whose scrape just failed shows "-" rather than fake
 * zeros.
 */
export interface HostFacts {
	readonly cores: number | null
	readonly memoryTotalBytes: number | null
	readonly diskTotalBytes: number | null
}

/** Instant PromQL per hardware fact, scoped to a single VPS. */
export const buildHostFactExprs = (
	vpsName: string,
): Readonly<Record<keyof HostFacts, string>> => ({
	cores: NODE_EXPORTER_EXPR.cores(vpsName),
	memoryTotalBytes: NODE_EXPORTER_EXPR.memoryTotalBytes(vpsName),
	diskTotalBytes: NODE_EXPORTER_EXPR.diskTotalBytes(vpsName),
})

const BYTES_PER_GIB = 1_073_741_824

/**
 * Bytes -> whole gibibytes for display ("4 GB" for a 4-GiB host). Machine
 * sizes are GiB-denominated, so GiB rounding recovers the nominal size a
 * decimal division would undershoot (4 GiB / 1e9 = 4.29).
 */
export const bytesToWholeGb = (bytes: number | null): number | null =>
	bytes === null ? null : Math.round(bytes / BYTES_PER_GIB)

/** Bytes moved in each direction over a time window. */
export interface TrafficTotals {
	readonly inBytes: number | null
	readonly outBytes: number | null
}
