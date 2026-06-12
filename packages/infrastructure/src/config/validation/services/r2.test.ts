import { describe, expect, it } from 'vitest'

import { validateR2Service } from './r2.ts'

describe('validateR2Service', () => {
	it('parses a table-array of buckets and defaults cdn to false when omitted', () => {
		const validation = validateR2Service({
			buckets: [{ name: 'uploads', cdn: true }, { name: 'media' }],
		})
		expect(validation).toEqual({
			ok: true,
			section: {
				buckets: [
					{ name: 'uploads', cdn: true },
					{ name: 'media', cdn: false },
				],
			},
		})
	})

	it('rejects a non-table [services.r2] section', () => {
		const validation = validateR2Service('uploads')
		expect(validation.ok).toBe(false)
		if (validation.ok)
			expect.unreachable('expected a non-table section to fail')
		expect(validation.errors).toEqual(['[services.r2] must be a table'])
	})

	it('rejects when buckets is not an array', () => {
		const validation = validateR2Service({ buckets: 'uploads' })
		expect(validation.ok).toBe(false)
		if (validation.ok)
			expect.unreachable('expected non-array buckets to fail')
		expect(validation.errors).toContain(
			'services.r2.buckets must be an array of bucket tables',
		)
	})

	it('rejects an empty bucket list', () => {
		const validation = validateR2Service({ buckets: [] })
		expect(validation.ok).toBe(false)
		if (validation.ok) expect.unreachable('expected an empty list to fail')
		expect(validation.errors).toContain(
			'services.r2.buckets must declare at least one bucket',
		)
	})

	it('rejects entries that are not tables', () => {
		const validation = validateR2Service({ buckets: ['uploads'] })
		expect(validation.ok).toBe(false)
		if (validation.ok) expect.unreachable('expected a string entry to fail')
		expect(validation.errors).toContain(
			'services.r2.buckets entries must be tables with a `name` field',
		)
	})

	it('rejects entries missing a name', () => {
		const validation = validateR2Service({ buckets: [{ cdn: true }] })
		expect(validation.ok).toBe(false)
		if (validation.ok)
			expect.unreachable('expected a nameless entry to fail')
		expect(validation.errors).toContain(
			'services.r2.buckets entries must declare a non-empty string `name`',
		)
	})

	it.each(['UPPER', 'snake_case', '-leading', 'trailing-', 'has space'])(
		'rejects unsafe bucket name: %s',
		name => {
			const validation = validateR2Service({ buckets: [{ name }] })
			expect(validation.ok).toBe(false)
			if (validation.ok)
				expect.unreachable('expected an unsafe name to fail')
			expect(
				validation.errors.some(e => e.includes(`entry "${name}"`)),
			).toBe(true)
		},
	)

	it('rejects duplicate bucket names', () => {
		const validation = validateR2Service({
			buckets: [{ name: 'uploads' }, { name: 'uploads' }],
		})
		expect(validation.ok).toBe(false)
		if (validation.ok)
			expect.unreachable('expected a duplicate name to fail')
		expect(validation.errors).toContain(
			'services.r2.buckets entry "uploads" is duplicated',
		)
	})

	it('rejects a non-boolean cdn flag', () => {
		const validation = validateR2Service({
			buckets: [{ name: 'uploads', cdn: 'yes' }],
		})
		expect(validation.ok).toBe(false)
		if (validation.ok)
			expect.unreachable('expected a non-boolean cdn to fail')
		expect(validation.errors).toContain(
			'services.r2.buckets entry "uploads" `cdn` must be a boolean',
		)
	})
})
