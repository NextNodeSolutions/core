import { describe, expect, it } from 'vitest'

import { executeHandlers } from './execute-handlers.ts'

const RESOURCES = ['alpha', 'beta', 'gamma'] as const

describe('executeHandlers', () => {
	it('returns a complete record with one entry per resource', async () => {
		const outcome = await executeHandlers(RESOURCES, {
			alpha: async () => ({ handled: true, detail: 'created' }),
			beta: async () => ({ handled: false, detail: 'skipped' }),
			gamma: async () => ({ handled: true, detail: 'updated' }),
		})

		expect(outcome).toEqual({
			alpha: { handled: true, detail: 'created' },
			beta: { handled: false, detail: 'skipped' },
			gamma: { handled: true, detail: 'updated' },
		})
	})

	it('calls handlers in tuple order', async () => {
		const callOrder: string[] = []

		await executeHandlers(RESOURCES, {
			alpha: async () => {
				callOrder.push('alpha')
				return { handled: true, detail: '' }
			},
			beta: async () => {
				callOrder.push('beta')
				return { handled: true, detail: '' }
			},
			gamma: async () => {
				callOrder.push('gamma')
				return { handled: true, detail: '' }
			},
		})

		expect(callOrder).toEqual(['alpha', 'beta', 'gamma'])
	})

	it('propagates handler errors without producing a partial record', async () => {
		await expect(
			executeHandlers(RESOURCES, {
				alpha: async () => ({ handled: true, detail: 'ok' }),
				beta: async () => {
					throw new Error('beta failed')
				},
				gamma: async () => ({ handled: true, detail: 'ok' }),
			}),
		).rejects.toThrow('beta failed')
	})

	it('works with a single-element tuple', async () => {
		const outcome = await executeHandlers(['only'] as const, {
			only: async () => ({ handled: true, detail: 'done' }),
		})

		expect(outcome).toEqual({
			only: { handled: true, detail: 'done' },
		})
	})
})
