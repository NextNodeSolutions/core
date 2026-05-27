import { describe, expect, it } from 'vitest'

import { validateSupabaseService } from './supabase.ts'

describe('validateSupabaseService', () => {
	it('accepts an empty table (gate only)', () => {
		const result = validateSupabaseService({})

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section).toEqual({})
	})

	it('rejects a non-table [services.supabase] section', () => {
		const result = validateSupabaseService('enabled')

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toEqual(['[services.supabase] must be a table'])
	})
})
