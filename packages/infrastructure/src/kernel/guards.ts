// Layer-agnostic kernel. Pure primitives importable at RUNTIME by every layer
// (index, cli, domain, adapters, config). Depends on nothing in-app - Node
// stdlib only - so it sits BELOW config and can be shared across the
// config↔domain boundary that the "types only" import rule otherwise blocks.

/**
 * Narrow an unknown value to a plain object record. Rejects `null` and arrays,
 * so `value.key` access downstream is sound. The single canonical record guard
 * for the whole package.
 */
export function isRecord(
	candidate: unknown,
): candidate is Record<string, unknown> {
	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		!Array.isArray(candidate)
	)
}
