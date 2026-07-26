// FNV-1a, 32 bits. A namespace id must be a stable number derived from a name,
// and this is the smallest hash that does it without a dependency.
const FNV_OFFSET_BASIS = 2166136261
const FNV_PRIME = 16777619

const ENCODER = new TextEncoder()

function fnv1a32(namespaceKey: string): number {
	let hash = FNV_OFFSET_BASIS
	for (const byte of ENCODER.encode(namespaceKey)) {
		hash ^= byte
		hash = Math.imul(hash, FNV_PRIME)
	}
	return hash >>> 0
}

/**
 * The `namespace_id` of one Rate Limit binding. The id is unique ACCOUNT-wide:
 * two bindings sharing it share their counters, across projects and across
 * environments. Hashing project + environment + worker + limiter name is what
 * keeps a development burst from consuming the production budget - never
 * shorten the key to the limiter name.
 */
export function computeRateLimiterNamespaceId(
	projectName: string,
	environment: string,
	workerName: string,
	limiterName: string,
): string {
	return String(
		fnv1a32(`${projectName}-${environment}-${workerName}-${limiterName}`),
	)
}
