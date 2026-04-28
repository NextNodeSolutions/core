/**
 * Async memoization with TTL + in-flight request dedup.
 *
 * Thin wrapper over `@epic-web/cachified` (semantics) backed by `lru-cache`
 * (bounded memory). The monitoring app re-fetches the same upstream data on
 * every navigation (Hetzner servers, Cloudflare projects, Tailscale devices);
 * `cachified` collapses the redundant work:
 *
 * - **TTL cache**: a successful fetch is reused until `ttlMs` elapses. Failed
 *   fetches are NEVER cached — the next call retries fresh.
 * - **In-flight dedup**: when two callers ask for the same key while a fetch
 *   is in flight, the second one awaits the first instead of duplicating it.
 *
 * Each memoized function is its own closure-scoped cache, so type safety is
 * preserved end-to-end.
 */

import { cachified } from '@epic-web/cachified'
import type { Cache, CacheEntry } from '@epic-web/cachified'
import { LRUCache } from 'lru-cache'

const DEFAULT_MAX_ENTRIES = 1000
const SINGLETON_KEY = 'value'

interface BackedCache<Value> {
	readonly cache: Cache<Value>
	readonly clear: () => void
}

const createLRUBackedCache = <Value>(max: number): BackedCache<Value> => {
	const lru = new LRUCache<string, CacheEntry<Value>>({ max })
	const cache: Cache<Value> = {
		get: key => lru.get(key),
		set: (key, value) => {
			lru.set(key, value)
		},
		delete: key => {
			lru.delete(key)
		},
	}
	return { cache, clear: () => lru.clear() }
}

export interface MemoizedAsync<T> {
	(): Promise<T>
	invalidate(): void
}

export const memoizeAsync = <T>(
	ttlMs: number,
	fetcher: () => Promise<T>,
): MemoizedAsync<T> => {
	const { cache } = createLRUBackedCache<T>(1)

	const get = (): Promise<T> =>
		cachified({
			key: SINGLETON_KEY,
			cache,
			ttl: ttlMs,
			getFreshValue: fetcher,
		})

	const invalidate = (): void => {
		cache.delete(SINGLETON_KEY)
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
	const { cache, clear } = createLRUBackedCache<TValue>(DEFAULT_MAX_ENTRIES)

	const get = (args: TArgs): Promise<TValue> =>
		cachified({
			key: keyOf(args),
			cache,
			ttl: ttlMs,
			getFreshValue: () => fetcher(args),
		})

	const invalidate = (args?: TArgs): void => {
		if (args === undefined) {
			clear()
			return
		}
		cache.delete(keyOf(args))
	}

	return Object.assign(get, { invalidate })
}
