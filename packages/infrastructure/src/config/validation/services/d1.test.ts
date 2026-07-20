import { describe, expect, it } from 'vitest'

import { validateD1Service } from './d1.ts'

describe('validateD1Service', () => {
	it('defaults migrations_folder to drizzle when omitted', () => {
		const validation = validateD1Service({})

		expect(validation).toEqual({
			ok: true,
			section: { migrationsFolder: 'drizzle' },
		})
	})

	it('parses an explicit migrations_folder override', () => {
		const validation = validateD1Service({
			migrations_folder: 'src/db/migrations',
		})

		expect(validation.ok).toBe(true)
		if (!validation.ok) return
		expect(validation.section.migrationsFolder).toBe('src/db/migrations')
	})

	it('parses an explicit check_command override', () => {
		const validation = validateD1Service({
			check_command: 'pnpm drizzle-kit check',
		})

		expect(validation.ok).toBe(true)
		if (!validation.ok) return
		expect(validation.section).toEqual({
			migrationsFolder: 'drizzle',
			checkCommand: 'pnpm drizzle-kit check',
		})
	})

	it('rejects a non-table [services.d1] section', () => {
		const validation = validateD1Service('drizzle')

		expect(validation.ok).toBe(false)
		if (validation.ok) expect.unreachable('expected a non-table to fail')
		expect(validation.errors).toEqual(['[services.d1] must be a table'])
	})

	it('rejects an empty migrations_folder string', () => {
		const validation = validateD1Service({ migrations_folder: '' })

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain(
			'services.d1.migrations_folder must be a non-empty string when set',
		)
	})

	it('rejects a non-string migrations_folder', () => {
		const validation = validateD1Service({ migrations_folder: 42 })

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain(
			'services.d1.migrations_folder must be a non-empty string when set',
		)
	})

	it('rejects an empty check_command string', () => {
		const validation = validateD1Service({ check_command: '' })

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain(
			'services.d1.check_command must be a non-empty string when set',
		)
	})

	it('rejects a non-string check_command', () => {
		const validation = validateD1Service({ check_command: 42 })

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain(
			'services.d1.check_command must be a non-empty string when set',
		)
	})
})
