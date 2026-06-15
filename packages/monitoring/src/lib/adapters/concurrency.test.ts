import { describe, expect, it } from 'vitest'

import { mapWithConcurrency } from '@/lib/adapters/concurrency.ts'

const deferred = <Resolved>(): {
	promise: Promise<Resolved>
	resolve: (resolved: Resolved) => void
} => {
	let resolve!: (resolved: Resolved) => void
	const promise = new Promise<Resolved>(capture => {
		resolve = capture
	})
	return { promise, resolve }
}

describe('mapWithConcurrency', () => {
	it('preserves input order in the results regardless of completion order', async () => {
		const results = await mapWithConcurrency(
			[1, 2, 3, 4],
			2,
			async input => input * 10,
		)

		expect(results).toEqual([10, 20, 30, 40])
	})

	it('never runs more than `limit` tasks at once', async () => {
		const LIMIT = 2
		const TASK_COUNT = 6
		const gates = Array.from({ length: TASK_COUNT }, () => deferred<void>())
		let active = 0
		let peak = 0

		const pending = mapWithConcurrency(
			gates,
			LIMIT,
			async (gate, index) => {
				active++
				peak = Math.max(peak, active)
				await gate.promise
				active--
				return index
			},
		)

		// Release the gates one at a time; the pool must keep at most LIMIT
		// tasks in flight, so peak can never exceed LIMIT.
		for (const gate of gates) {
			gate.resolve()
			// oxlint-disable-next-line eslint/no-await-in-loop -- step the microtask queue per gate
			await Promise.resolve()
		}
		const order = await pending

		expect(peak).toBe(LIMIT)
		expect(order).toEqual([0, 1, 2, 3, 4, 5])
	})

	it('runs everything (no task dropped) when limit exceeds the input length', async () => {
		const seen: Array<number> = []
		await mapWithConcurrency([1, 2, 3], 10, async input => {
			seen.push(input)
			return input
		})

		expect(seen.toSorted((a, b) => a - b)).toEqual([1, 2, 3])
	})
})
