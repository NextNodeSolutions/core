import type {
	CheckLimitResult,
	RateLimiterState,
} from '../domain/rate-limiter.ts'
import { checkLimit, emptyState } from '../domain/rate-limiter.ts'

export interface RateLimiterStore {
	check(tenantId: string, limitRpm: number): CheckLimitResult
	reset(tenantId: string): void
	clear(): void
	size(): number
}

export interface RateLimiterStoreOptions {
	/**
	 * Clock in milliseconds-since-epoch. Defaults to `Date.now`. Tests inject a
	 * mutable counter to advance time deterministically.
	 */
	readonly clock?: () => number
}

/**
 * In-memory per-tenant rate limiter. Owns the clock and the per-tenant state
 * map. All decision-making lives in `domain/rate-limiter.ts`.
 *
 * The state map grows with every new tenant and never shrinks automatically —
 * acceptable for the expected number of tenants (~tens). A periodic sweep can
 * be added later if the map outgrows its usefulness.
 */
export function createRateLimiterStore(
	options: RateLimiterStoreOptions = {},
): RateLimiterStore {
	const clock = options.clock ?? Date.now
	const states = new Map<string, RateLimiterState>()

	function check(tenantId: string, limitRpm: number): CheckLimitResult {
		const current = states.get(tenantId) ?? emptyState()
		const result = checkLimit(current, clock(), limitRpm)
		states.set(tenantId, result.newState)
		return result
	}

	function reset(tenantId: string): void {
		states.delete(tenantId)
	}

	function clear(): void {
		states.clear()
	}

	function size(): number {
		return states.size
	}

	return { check, reset, clear, size }
}
