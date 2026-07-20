import { describe, expect, it } from 'vitest'

import { validateKvService } from './kv.ts'

describe('validateKvService', () => {
	it('parses a table-array of namespaces', () => {
		const validation = validateKvService({
			namespaces: [{ name: 'sessions' }, { name: 'cache' }],
		})

		expect(validation).toEqual({
			ok: true,
			section: {
				namespaces: [{ name: 'sessions' }, { name: 'cache' }],
			},
		})
	})

	it('rejects a non-table [services.kv] section', () => {
		const validation = validateKvService('sessions')

		expect(validation.ok).toBe(false)
		if (validation.ok) expect.unreachable('expected a non-table to fail')
		expect(validation.errors).toEqual(['[services.kv] must be a table'])
	})

	it('rejects when namespaces is not an array', () => {
		const validation = validateKvService({ namespaces: 'sessions' })

		expect(validation.ok).toBe(false)
		if (validation.ok) expect.unreachable('expected non-array to fail')
		expect(validation.errors).toContain(
			'services.kv.namespaces must be an array of namespace tables',
		)
	})

	it('rejects an empty namespace list', () => {
		const validation = validateKvService({ namespaces: [] })

		expect(validation.ok).toBe(false)
		if (validation.ok) expect.unreachable('expected an empty list to fail')
		expect(validation.errors).toContain(
			'services.kv.namespaces must declare at least one namespace',
		)
	})

	it('rejects entries that are not tables', () => {
		const validation = validateKvService({ namespaces: ['sessions'] })

		expect(validation.ok).toBe(false)
		if (validation.ok) expect.unreachable('expected a string entry to fail')
		expect(validation.errors).toContain(
			'services.kv.namespaces entries must be tables with a `name` field',
		)
	})

	it('rejects entries missing a name', () => {
		const validation = validateKvService({ namespaces: [{}] })

		expect(validation.ok).toBe(false)
		if (validation.ok)
			expect.unreachable('expected a nameless entry to fail')
		expect(validation.errors).toContain(
			'services.kv.namespaces entries must declare a non-empty string `name`',
		)
	})

	it.each(['UPPER', 'snake_case', '-leading', 'trailing-', 'has space'])(
		'rejects unsafe namespace name: %s',
		name => {
			const validation = validateKvService({ namespaces: [{ name }] })

			expect(validation.ok).toBe(false)
			if (validation.ok)
				expect.unreachable('expected an unsafe name to fail')
			expect(
				validation.errors.some(e => e.includes(`entry "${name}"`)),
			).toBe(true)
		},
	)

	it('rejects duplicate namespace names', () => {
		const validation = validateKvService({
			namespaces: [{ name: 'cache' }, { name: 'cache' }],
		})

		expect(validation.ok).toBe(false)
		if (validation.ok) expect.unreachable('expected a duplicate to fail')
		expect(validation.errors).toContain(
			'services.kv.namespaces entry "cache" is duplicated',
		)
	})
})
