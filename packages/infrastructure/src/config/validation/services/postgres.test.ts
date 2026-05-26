import { describe, expect, it } from 'vitest'

import { validatePostgresService } from './postgres.ts'

describe('validatePostgresService', () => {
	it('parses a valid embedded config', () => {
		const result = validatePostgresService({ mode: 'embedded' })

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section).toEqual({
			mode: 'embedded',
		})
	})

	it('parses an explicit migrations_folder override', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			migrations_folder: 'src/db/migrations',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section.migrationsFolder).toBe('src/db/migrations')
	})

	it('rejects an empty migrations_folder string', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			migrations_folder: '',
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.postgres.migrations_folder must be a non-empty string when set',
		)
	})

	it('rejects a non-string migrations_folder', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			migrations_folder: 42,
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.postgres.migrations_folder must be a non-empty string when set',
		)
	})

	it('parses an explicit migrate_command override', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			migrate_command: 'pnpm prisma migrate deploy',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section.migrateCommand).toBe('pnpm prisma migrate deploy')
	})

	it('rejects an empty migrate_command string', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			migrate_command: '',
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.postgres.migrate_command must be a non-empty string when set',
		)
	})

	it('rejects a non-string migrate_command', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			migrate_command: 42,
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.postgres.migrate_command must be a non-empty string when set',
		)
	})

	it('parses an explicit check_command override', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			check_command: 'pnpm prisma migrate diff --exit-code',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section.checkCommand).toBe(
			'pnpm prisma migrate diff --exit-code',
		)
	})

	it('rejects an empty check_command string', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			check_command: '',
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.postgres.check_command must be a non-empty string when set',
		)
	})

	it('rejects a non-string check_command', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			check_command: 42,
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.postgres.check_command must be a non-empty string when set',
		)
	})

	it('parses a valid external config', () => {
		const result = validatePostgresService({ mode: 'external' })

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section.mode).toBe('external')
	})

	it('rejects a non-table [services.postgres] section', () => {
		const result = validatePostgresService('embedded')

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toEqual(['[services.postgres] must be a table'])
	})

	it('rejects an unknown mode value', () => {
		const result = validatePostgresService({ mode: 'managed' })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.postgres.mode must be one of: embedded, external',
		)
	})
})
