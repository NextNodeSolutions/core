import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { keyedMemoizeAsync, memoizeAsync } from '@/lib/adapters/cache.ts'

const TTL_MS = 5_000
const HALF_TTL_MS = 2_500
const PAST_TTL_MS = 6_000

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('memoizeAsync', () => {
	it('returns the cached value while within TTL', async () => {
		const fetcher = vi.fn().mockResolvedValue('first')
		const cached = memoizeAsync(TTL_MS, fetcher)

		const a = await cached()
		vi.advanceTimersByTime(HALF_TTL_MS)
		const b = await cached()

		expect(a).toBe('first')
		expect(b).toBe('first')
		expect(fetcher).toHaveBeenCalledTimes(1)
	})

	it('re-fetches once the entry has expired', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce('first')
			.mockResolvedValueOnce('second')
		const cached = memoizeAsync(TTL_MS, fetcher)

		await cached()
		vi.advanceTimersByTime(PAST_TTL_MS)
		const second = await cached()

		expect(second).toBe('second')
		expect(fetcher).toHaveBeenCalledTimes(2)
	})

	it('dedupes concurrent callers into a single in-flight request', async () => {
		const deferred = Promise.withResolvers<number>()
		const fetcher = vi.fn(() => deferred.promise)
		const cached = memoizeAsync(TTL_MS, fetcher)

		const first = cached()
		const second = cached()
		deferred.resolve(42)

		expect(await first).toBe(42)
		expect(await second).toBe(42)
		expect(fetcher).toHaveBeenCalledTimes(1)
	})

	it('does not cache rejected fetches', async () => {
		const fetcher = vi
			.fn()
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValueOnce('recovered')
		const cached = memoizeAsync(TTL_MS, fetcher)

		await expect(cached()).rejects.toThrow('boom')
		const recovered = await cached()

		expect(recovered).toBe('recovered')
		expect(fetcher).toHaveBeenCalledTimes(2)
	})

	it('invalidate() forces a fresh fetch on the next call', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce('first')
			.mockResolvedValueOnce('second')
		const cached = memoizeAsync(TTL_MS, fetcher)

		await cached()
		cached.invalidate()
		const second = await cached()

		expect(second).toBe('second')
		expect(fetcher).toHaveBeenCalledTimes(2)
	})
})

describe('keyedMemoizeAsync', () => {
	it('caches each key independently', async () => {
		const fetcher = vi.fn(async (id: string) => `value-${id}`)
		const cached = keyedMemoizeAsync(TTL_MS, (id: string) => id, fetcher)

		const a = await cached('a')
		const b = await cached('b')
		const aAgain = await cached('a')

		expect(a).toBe('value-a')
		expect(b).toBe('value-b')
		expect(aAgain).toBe('value-a')
		expect(fetcher).toHaveBeenCalledTimes(2)
	})

	it('dedupes concurrent callers per key', async () => {
		const deferredA = Promise.withResolvers<string>()
		const deferredB = Promise.withResolvers<string>()
		const fetcher = vi.fn((id: string) =>
			id === 'a' ? deferredA.promise : deferredB.promise,
		)
		const cached = keyedMemoizeAsync(TTL_MS, (id: string) => id, fetcher)

		const a1 = cached('a')
		const a2 = cached('a')
		const b = cached('b')
		deferredA.resolve('value-a')
		deferredB.resolve('value-b')

		expect(await a1).toBe('value-a')
		expect(await a2).toBe('value-a')
		expect(await b).toBe('value-b')
		expect(fetcher).toHaveBeenCalledTimes(2)
	})

	it('does not cache failed fetches per key', async () => {
		const fetcher = vi
			.fn<(id: string) => Promise<string>>()
			.mockRejectedValueOnce(new Error('upstream down'))
			.mockResolvedValueOnce('value-a')
		const cached = keyedMemoizeAsync(TTL_MS, (id: string) => id, fetcher)

		await expect(cached('a')).rejects.toThrow('upstream down')
		const recovered = await cached('a')

		expect(recovered).toBe('value-a')
		expect(fetcher).toHaveBeenCalledTimes(2)
	})

	it('invalidate(key) clears only the targeted entry', async () => {
		const fetcher = vi
			.fn<(id: string) => Promise<string>>()
			.mockResolvedValueOnce('a-1')
			.mockResolvedValueOnce('b-1')
			.mockResolvedValueOnce('a-2')
		const cached = keyedMemoizeAsync(TTL_MS, (id: string) => id, fetcher)

		await cached('a')
		await cached('b')
		cached.invalidate('a')
		const a2 = await cached('a')
		const b2 = await cached('b')

		expect(a2).toBe('a-2')
		expect(b2).toBe('b-1')
		expect(fetcher).toHaveBeenCalledTimes(3)
	})

	it('invalidate() with no argument clears every entry', async () => {
		const fetcher = vi
			.fn<(id: string) => Promise<string>>()
			.mockResolvedValueOnce('a-1')
			.mockResolvedValueOnce('b-1')
			.mockResolvedValueOnce('a-2')
			.mockResolvedValueOnce('b-2')
		const cached = keyedMemoizeAsync(TTL_MS, (id: string) => id, fetcher)

		await cached('a')
		await cached('b')
		cached.invalidate()
		const a2 = await cached('a')
		const b2 = await cached('b')

		expect(a2).toBe('a-2')
		expect(b2).toBe('b-2')
		expect(fetcher).toHaveBeenCalledTimes(4)
	})
})
