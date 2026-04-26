import { describe, expect, it } from 'vitest'

import { validateR2Service } from './r2.ts'

describe('validateR2Service', () => {
	it('parses a valid bucket alias list', () => {
		const result = validateR2Service({ buckets: ['uploads', 'media'] })
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section).toEqual({ buckets: ['uploads', 'media'] })
	})

	it('rejects a non-table [services.r2] section', () => {
		const result = validateR2Service('uploads')
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toEqual(['[services.r2] must be a table'])
	})

	it('rejects when buckets is not an array', () => {
		const result = validateR2Service({ buckets: 'uploads' })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.r2.buckets must be an array of strings',
		)
	})

	it('rejects an empty bucket list', () => {
		const result = validateR2Service({ buckets: [] })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.r2.buckets must declare at least one bucket alias',
		)
	})

	it('rejects empty-string aliases', () => {
		const result = validateR2Service({ buckets: ['uploads', ''] })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.r2.buckets entries must be non-empty strings',
		)
	})

	it.each(['UPPER', 'snake_case', '-leading', 'trailing-', 'has space'])(
		'rejects unsafe alias: %s',
		alias => {
			const result = validateR2Service({ buckets: [alias] })
			expect(result.ok).toBe(false)
			if (result.ok) return
			expect(
				result.errors.some(e => e.includes(`entry "${alias}"`)),
			).toBe(true)
		},
	)

	it('rejects duplicate aliases', () => {
		const result = validateR2Service({ buckets: ['uploads', 'uploads'] })
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.r2.buckets entry "uploads" is duplicated',
		)
	})
})
