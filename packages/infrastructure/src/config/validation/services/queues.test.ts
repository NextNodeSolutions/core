import { describe, expect, it } from 'vitest'

import { validateQueuesService } from './queues.ts'

describe('validateQueuesService', () => {
	it('parses a table-array of queues', () => {
		const validation = validateQueuesService([
			{ name: 'emails' },
			{ name: 'jobs' },
		])

		expect(validation).toEqual({
			ok: true,
			section: {
				queues: [{ name: 'emails' }, { name: 'jobs' }],
			},
		})
	})

	it('rejects a non-array [[services.queues]] section', () => {
		const validation = validateQueuesService({ name: 'emails' })

		expect(validation.ok).toBe(false)
		if (validation.ok) expect.unreachable('expected a table to fail')
		expect(validation.errors).toContain(
			'[[services.queues]] must be an array of queue tables',
		)
	})

	it('rejects an empty queue list', () => {
		const validation = validateQueuesService([])

		expect(validation.ok).toBe(false)
		if (validation.ok) expect.unreachable('expected an empty list to fail')
		expect(validation.errors).toContain(
			'[[services.queues]] must declare at least one queue',
		)
	})

	it('rejects entries that are not tables', () => {
		const validation = validateQueuesService(['emails'])

		expect(validation.ok).toBe(false)
		if (validation.ok) expect.unreachable('expected a string entry to fail')
		expect(validation.errors).toContain(
			'services.queues entries must be tables with a `name` field',
		)
	})

	it('rejects entries missing a name', () => {
		const validation = validateQueuesService([{}])

		expect(validation.ok).toBe(false)
		if (validation.ok)
			expect.unreachable('expected a nameless entry to fail')
		expect(validation.errors).toContain(
			'services.queues entries must declare a non-empty string `name`',
		)
	})

	it.each(['UPPER', 'snake_case', '-leading', 'trailing-', 'has space'])(
		'rejects unsafe queue name: %s',
		name => {
			const validation = validateQueuesService([{ name }])

			expect(validation.ok).toBe(false)
			if (validation.ok)
				expect.unreachable('expected an unsafe name to fail')
			expect(
				validation.errors.some(e => e.includes(`entry "${name}"`)),
			).toBe(true)
		},
	)

	it('rejects duplicate queue names', () => {
		const validation = validateQueuesService([
			{ name: 'jobs' },
			{ name: 'jobs' },
		])

		expect(validation.ok).toBe(false)
		if (validation.ok) expect.unreachable('expected a duplicate to fail')
		expect(validation.errors).toContain(
			'services.queues entry "jobs" is duplicated',
		)
	})
})
