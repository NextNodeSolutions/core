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

/** Canonical all-null facts - the shape a failed facts load degrades to. */
export const NULL_HOST_FACTS: HostFacts = {
	cores: null,
	memoryTotalBytes: null,
	diskTotalBytes: null,
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
const BYTES_PER_GB = 1_000_000_000

/**
 * Bytes -> whole gibibytes for RAM display ("4 GB" for a 4-GiB host). RAM
 * sizes are GiB-denominated, so GiB rounding recovers the nominal size a
 * decimal division would undershoot (4 GiB / 1e9 = 4.29).
 */
export const bytesToWholeGb = (bytes: number | null): number | null => {
	if (bytes === null) return null
	return Math.round(bytes / BYTES_PER_GIB)
}

/**
 * Bytes -> whole decimal gigabytes for DISK display: block devices are sold
 * decimal-GB-denominated ("40 GB"), so decimal rounding tracks the nominal
 * size where GiB rounding would undershoot (a ~39e9-byte root fs reads
 * "39 GB", not "36 GB").
 */
export const bytesToWholeDecimalGb = (bytes: number | null): number | null => {
	if (bytes === null) return null
	return Math.round(bytes / BYTES_PER_GB)
}

/** Bytes moved in each direction over a time window. */
export interface TrafficTotals {
	readonly inBytes: number | null
	readonly outBytes: number | null
}

/** Canonical empty totals - the shape a failed traffic load degrades to. */
export const NULL_TRAFFIC_TOTALS: TrafficTotals = {
	inBytes: null,
	outBytes: null,
}
