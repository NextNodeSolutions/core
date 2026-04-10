/**
 * Reusable LRU-bounded scope color cache.
 * Used by console formatters to assign stable colors to scopes
 * without unbounded memory growth.
 */

const DEFAULT_MAX_CACHE_SIZE = 100

export interface ScopeColorCache<TColor> {
	/** Returns a stable color for a given scope, assigning one on first use. */
	readonly resolve: (scope: string) => TColor
	/** Clears all cached scope → color associations. */
	readonly reset: () => void
}

export interface CreateScopeColorCacheOptions<TColor> {
	readonly palette: readonly TColor[]
	readonly fallback: TColor
	readonly maxSize?: number
}

/**
 * Creates a bounded round-robin color cache.
 *
 * The cache assigns palette colors to scopes in order and remembers the
 * assignment so the same scope always gets the same color within the
 * cache's lifetime. When `maxSize` is reached, the oldest entry is evicted.
 */
export const createScopeColorCache = <TColor>(
	options: CreateScopeColorCacheOptions<TColor>,
): ScopeColorCache<TColor> => {
	const { palette, fallback, maxSize = DEFAULT_MAX_CACHE_SIZE } = options
	const cache = new Map<string, TColor>()
	let nextIndex = 0

	const resolve = (scope: string): TColor => {
		const existing = cache.get(scope)
		if (existing !== undefined) return existing

		if (cache.size >= maxSize) {
			const oldestKey = cache.keys().next().value
			if (oldestKey !== undefined) cache.delete(oldestKey)
		}

		const color = palette[nextIndex % palette.length] ?? fallback
		cache.set(scope, color)
		nextIndex = (nextIndex + 1) % palette.length
		return color
	}

	const reset = (): void => {
		cache.clear()
		nextIndex = 0
	}

	return { resolve, reset }
}
