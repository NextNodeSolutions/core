import { describe, expect, it } from 'vitest'

import { validateSupabaseService } from './supabase.ts'

describe('validateSupabaseService', () => {
	it('accepts an empty table (gate only)', () => {
		const validation = validateSupabaseService({})

		expect(validation.ok).toBe(true)
		if (!validation.ok) return
		expect(validation.section).toEqual({})
	})

	it('rejects a non-table [services.supabase] section', () => {
		const validation = validateSupabaseService('enabled')

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toEqual([
			'[services.supabase] must be a table',
		])
	})
})
