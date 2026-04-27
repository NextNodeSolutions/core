/**
 * Async memoization with TTL + in-flight request dedup.
 *
 * The monitoring app re-fetches the same upstream data on every navigation
 * (Hetzner servers, Cloudflare projects, Tailscale devices). Wrapping each
 * fetcher in `memoizeAsync` (or `keyedMemoizeAsync` for argument-dependent
 * fetchers) collapses redundant work:
 *
 * - **TTL cache**: a successful fetch is reused until `expiresAt`. Failed
 *   fetches are NEVER cached — the next call retries fresh.
 * - **In-flight dedup**: when two callers ask for the same key while a fetch
 *   is in flight, the second one awaits the first instead of duplicating it.
 *
 * Each memoized function is its own closure-scoped cache, so type safety is
 * preserved end-to-end without `as` assertions.
 */

interface CacheEntry<T> {
	readonly value: T
	readonly expiresAt: number
}

export interface MemoizedAsync<T> {
	(): Promise<T>
	invalidate(): void
}

export const memoizeAsync = <T>(
	ttlMs: number,
	fetcher: () => Promise<T>,
): MemoizedAsync<T> => {
	let entry: CacheEntry<T> | null = null
	let inFlight: Promise<T> | null = null

	const get = async (): Promise<T> => {
		const now = Date.now()
		if (entry && entry.expiresAt > now) return entry.value
		if (inFlight) return inFlight
		const promise = fetcher().then(
			value => {
				entry = { value, expiresAt: Date.now() + ttlMs }
				inFlight = null
				return value
			},
			(error: unknown) => {
				inFlight = null
				throw error
			},
		)
		inFlight = promise
		return promise
	}

	const invalidate = (): void => {
		entry = null
		inFlight = null
	}

	return Object.assign(get, { invalidate })
}

export interface KeyedMemoizedAsync<TArgs, TValue> {
	(args: TArgs): Promise<TValue>
	invalidate(args?: TArgs): void
}

export const keyedMemoizeAsync = <TArgs, TValue>(
	ttlMs: number,
	keyOf: (args: TArgs) => string,
	fetcher: (args: TArgs) => Promise<TValue>,
): KeyedMemoizedAsync<TArgs, TValue> => {
	const entries = new Map<string, CacheEntry<TValue>>()
	const inFlight = new Map<string, Promise<TValue>>()

	const get = async (args: TArgs): Promise<TValue> => {
		const key = keyOf(args)
		const now = Date.now()
		const existing = entries.get(key)
		if (existing && existing.expiresAt > now) return existing.value
		const pending = inFlight.get(key)
		if (pending) return pending
		const promise = fetcher(args).then(
			value => {
				entries.set(key, { value, expiresAt: Date.now() + ttlMs })
				inFlight.delete(key)
				return value
			},
			(error: unknown) => {
				inFlight.delete(key)
				throw error
			},
		)
		inFlight.set(key, promise)
		return promise
	}

	const invalidate = (args?: TArgs): void => {
		if (args === undefined) {
			entries.clear()
			inFlight.clear()
			return
		}
		const key = keyOf(args)
		entries.delete(key)
		inFlight.delete(key)
	}

	return Object.assign(get, { invalidate })
}
