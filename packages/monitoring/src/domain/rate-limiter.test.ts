import { describe, expect, it } from 'vitest'

import { checkLimit, emptyState, RATE_LIMIT_WINDOW_MS } from './rate-limiter.ts'

const NOW = 1_700_000_000_000

describe('checkLimit', () => {
	it('allows the first request on an empty state', () => {
		const result = checkLimit(emptyState(), NOW, 10)

		expect(result.allowed).toBe(true)
		expect(result.remaining).toBe(9)
		expect(result.retryAfterMs).toBe(0)
		expect(result.newState.timestamps).toEqual([NOW])
	})

	it('decreases remaining on each allowed call', () => {
		let state = emptyState()

		const first = checkLimit(state, NOW, 3)
		expect(first.allowed).toBe(true)
		expect(first.remaining).toBe(2)
		state = first.newState

		const second = checkLimit(state, NOW + 10, 3)
		expect(second.allowed).toBe(true)
		expect(second.remaining).toBe(1)
		state = second.newState

		const third = checkLimit(state, NOW + 20, 3)
		expect(third.allowed).toBe(true)
		expect(third.remaining).toBe(0)
	})

	it('denies the next request when the limit is saturated', () => {
		let state = emptyState()
		for (let i = 0; i < 5; i++) {
			state = checkLimit(state, NOW + i, 5).newState
		}

		const result = checkLimit(state, NOW + 5, 5)

		expect(result.allowed).toBe(false)
		expect(result.remaining).toBe(0)
		expect(result.newState.timestamps).toHaveLength(5)
	})

	it('reports retryAfterMs based on the oldest in-window timestamp', () => {
		const state = { timestamps: [NOW, NOW + 100, NOW + 200] }
		const now = NOW + 300

		const result = checkLimit(state, now, 3)

		expect(result.allowed).toBe(false)
		expect(result.retryAfterMs).toBe(RATE_LIMIT_WINDOW_MS - 300)
	})

	it('drops expired timestamps and re-admits requests after the window slides', () => {
		const state = { timestamps: [NOW, NOW + 100, NOW + 200] }
		// Slide the window far enough that every existing timestamp is stale.
		const later = NOW + RATE_LIMIT_WINDOW_MS + 300

		const result = checkLimit(state, later, 3)

		expect(result.allowed).toBe(true)
		expect(result.newState.timestamps).toEqual([later])
	})

	it('prunes but keeps timestamps that are still in window', () => {
		const state = {
			timestamps: [
				NOW,
				NOW + RATE_LIMIT_WINDOW_MS + 1,
				NOW + RATE_LIMIT_WINDOW_MS + 2,
			],
		}
		const later = NOW + RATE_LIMIT_WINDOW_MS + 10

		const result = checkLimit(state, later, 5)

		expect(result.allowed).toBe(true)
		// NOW expired; the two that were newer than the window stay + the new now.
		expect(result.newState.timestamps).toEqual([
			NOW + RATE_LIMIT_WINDOW_MS + 1,
			NOW + RATE_LIMIT_WINDOW_MS + 2,
			later,
		])
	})

	it.each([0, -1, -100])(
		'denies every request when the limit is %i',
		limit => {
			const result = checkLimit(emptyState(), NOW, limit)

			expect(result.allowed).toBe(false)
			expect(result.remaining).toBe(0)
			expect(result.retryAfterMs).toBe(RATE_LIMIT_WINDOW_MS)
		},
	)

	it('is pure — the original state is not mutated', () => {
		const timestamps = [NOW, NOW + 10]
		const state = { timestamps }

		checkLimit(state, NOW + 20, 5)

		expect(timestamps).toEqual([NOW, NOW + 10])
	})
})
