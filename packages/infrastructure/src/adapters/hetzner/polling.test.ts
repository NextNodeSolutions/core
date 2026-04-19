import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pollUntil } from './polling.ts'

vi.mock('node:timers/promises', () => ({
	setTimeout: vi.fn(async () => undefined),
}))

beforeEach(() => {
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('pollUntil', () => {
	it('resolves on the first attempt when the predicate holds', async () => {
		const poll = vi.fn(async () => 'ready')
		const result = await pollUntil({
			subject: 'task',
			poll,
			isDone: value => value === 'ready',
			maxAttempts: 5,
			intervalMs: 10,
		})
		expect(result).toBe('ready')
		expect(poll).toHaveBeenCalledTimes(1)
	})

	it('keeps polling until the predicate holds', async () => {
		let tick = 0
		const poll = vi.fn(async () => {
			tick += 1
			return tick === 3 ? 'ready' : 'starting'
		})
		const result = await pollUntil({
			subject: 'task',
			poll,
			isDone: value => value === 'ready',
			maxAttempts: 5,
			intervalMs: 10,
		})
		expect(result).toBe('ready')
		expect(poll).toHaveBeenCalledTimes(3)
	})

	it('throws the timeout message when attempts are exhausted', async () => {
		const poll = vi.fn(async () => 'never-ready')
		await expect(
			pollUntil({
				subject: 'task',
				poll,
				isDone: value => value === 'ready',
				maxAttempts: 3,
				intervalMs: 10,
			}),
		).rejects.toThrow('task: timed out after 3 attempts')
		expect(poll).toHaveBeenCalledTimes(3)
	})
})
