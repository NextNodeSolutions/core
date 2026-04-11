export const RATE_LIMIT_WINDOW_MS = 60_000

export interface RateLimiterState {
	readonly timestamps: ReadonlyArray<number>
}

export interface CheckLimitResult {
	readonly allowed: boolean
	readonly newState: RateLimiterState
	readonly remaining: number
	readonly retryAfterMs: number
}

/**
 * Returns a fresh empty state — useful for initializing the per-tenant map in
 * the adapter layer.
 */
export function emptyState(): RateLimiterState {
	return { timestamps: [] }
}

/**
 * Pure sliding-window rate limiter.
 *
 * Caller owns the clock (`now`) and the limit (`limitRpm`) — this function has
 * no IO and no time dependency, so tests can march the clock deterministically.
 *
 * Algorithm:
 *   1. Drop timestamps older than `now - RATE_LIMIT_WINDOW_MS` (out of window).
 *   2. If the remaining count is below the limit, record `now` and allow.
 *   3. Otherwise deny, keep the pruned state, and report the wait time until
 *      the oldest in-window timestamp expires.
 */
export function checkLimit(
	state: RateLimiterState,
	now: number,
	limitRpm: number,
): CheckLimitResult {
	if (limitRpm <= 0) {
		return {
			allowed: false,
			newState: state,
			remaining: 0,
			retryAfterMs: RATE_LIMIT_WINDOW_MS,
		}
	}

	const cutoff = now - RATE_LIMIT_WINDOW_MS
	const recent = state.timestamps.filter(t => t > cutoff)

	if (recent.length < limitRpm) {
		return {
			allowed: true,
			newState: { timestamps: [...recent, now] },
			remaining: limitRpm - recent.length - 1,
			retryAfterMs: 0,
		}
	}

	const oldest = recent[0] ?? now
	const retryAfterMs = Math.max(0, oldest + RATE_LIMIT_WINDOW_MS - now)
	return {
		allowed: false,
		newState: { timestamps: recent },
		remaining: 0,
		retryAfterMs,
	}
}
