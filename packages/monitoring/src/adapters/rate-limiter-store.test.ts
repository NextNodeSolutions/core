import { beforeEach, describe, expect, it } from 'vitest'

import { createRateLimiterStore } from './rate-limiter-store.ts'

describe('createRateLimiterStore', () => {
	let now = 1_700_000_000_000
	const clock = (): number => now

	beforeEach(() => {
		now = 1_700_000_000_000
	})

	it('allows requests under the limit for a single tenant', () => {
		const store = createRateLimiterStore({ clock })

		expect(store.check('acme', 3).allowed).toBe(true)
		expect(store.check('acme', 3).allowed).toBe(true)
		expect(store.check('acme', 3).allowed).toBe(true)
	})

	it('denies the next request once the tenant saturates its limit', () => {
		const store = createRateLimiterStore({ clock })

		for (let i = 0; i < 3; i++) store.check('acme', 3)

		const result = store.check('acme', 3)
		expect(result.allowed).toBe(false)
		expect(result.retryAfterMs).toBeGreaterThan(0)
	})

	it('tracks tenants independently', () => {
		const store = createRateLimiterStore({ clock })

		for (let i = 0; i < 3; i++) store.check('acme', 3)

		expect(store.check('acme', 3).allowed).toBe(false)
		expect(store.check('globex', 3).allowed).toBe(true)
	})

	it('re-admits a saturated tenant after the window slides', () => {
		const store = createRateLimiterStore({ clock })

		for (let i = 0; i < 3; i++) store.check('acme', 3)
		expect(store.check('acme', 3).allowed).toBe(false)

		now += 60_001
		expect(store.check('acme', 3).allowed).toBe(true)
	})

	it('reset() drops the state for a single tenant', () => {
		const store = createRateLimiterStore({ clock })

		for (let i = 0; i < 3; i++) store.check('acme', 3)
		store.reset('acme')

		expect(store.check('acme', 3).allowed).toBe(true)
		expect(store.size()).toBe(1)
	})

	it('clear() empties the store', () => {
		const store = createRateLimiterStore({ clock })

		store.check('acme', 3)
		store.check('globex', 3)
		expect(store.size()).toBe(2)

		store.clear()
		expect(store.size()).toBe(0)
	})

	it('defaults the clock to Date.now when none is injected', () => {
		const store = createRateLimiterStore()

		const first = store.check('acme', 1)
		const second = store.check('acme', 1)

		expect(first.allowed).toBe(true)
		expect(second.allowed).toBe(false)
	})
})
