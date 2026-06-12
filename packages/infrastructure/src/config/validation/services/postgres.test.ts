import { describe, expect, it } from 'vitest'

import { validatePostgresService } from './postgres.ts'

describe('validatePostgresService', () => {
	it('parses a valid embedded config', () => {
		const validation = validatePostgresService({ mode: 'embedded' })

		expect(validation.ok).toBe(true)
		if (!validation.ok) return
		expect(validation.section).toEqual({
			mode: 'embedded',
		})
	})

	it('parses an explicit migrations_folder override', () => {
		const validation = validatePostgresService({
			mode: 'embedded',
			migrations_folder: 'src/db/migrations',
		})

		expect(validation.ok).toBe(true)
		if (!validation.ok) return
		expect(validation.section.migrationsFolder).toBe('src/db/migrations')
	})

	it('rejects an empty migrations_folder string', () => {
		const validation = validatePostgresService({
			mode: 'embedded',
			migrations_folder: '',
		})

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain(
			'services.postgres.migrations_folder must be a non-empty string when set',
		)
	})

	it('rejects a non-string migrations_folder', () => {
		const validation = validatePostgresService({
			mode: 'embedded',
			migrations_folder: 42,
		})

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain(
			'services.postgres.migrations_folder must be a non-empty string when set',
		)
	})

	it('parses an explicit migrate_command override', () => {
		const validation = validatePostgresService({
			mode: 'embedded',
			migrate_command: 'pnpm prisma migrate deploy',
		})

		expect(validation.ok).toBe(true)
		if (!validation.ok) return
		expect(validation.section.migrateCommand).toBe(
			'pnpm prisma migrate deploy',
		)
	})

	it('rejects an empty migrate_command string', () => {
		const validation = validatePostgresService({
			mode: 'embedded',
			migrate_command: '',
		})

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain(
			'services.postgres.migrate_command must be a non-empty string when set',
		)
	})

	it('rejects a non-string migrate_command', () => {
		const validation = validatePostgresService({
			mode: 'embedded',
			migrate_command: 42,
		})

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain(
			'services.postgres.migrate_command must be a non-empty string when set',
		)
	})

	it('parses an explicit check_command override', () => {
		const validation = validatePostgresService({
			mode: 'embedded',
			check_command: 'pnpm prisma migrate diff --exit-code',
		})

		expect(validation.ok).toBe(true)
		if (!validation.ok) return
		expect(validation.section.checkCommand).toBe(
			'pnpm prisma migrate diff --exit-code',
		)
	})

	it('rejects an empty check_command string', () => {
		const validation = validatePostgresService({
			mode: 'embedded',
			check_command: '',
		})

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain(
			'services.postgres.check_command must be a non-empty string when set',
		)
	})

	it('rejects a non-string check_command', () => {
		const validation = validatePostgresService({
			mode: 'embedded',
			check_command: 42,
		})

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain(
			'services.postgres.check_command must be a non-empty string when set',
		)
	})

	it('parses a valid external config', () => {
		const validation = validatePostgresService({ mode: 'external' })

		expect(validation.ok).toBe(true)
		if (!validation.ok) return
		expect(validation.section.mode).toBe('external')
	})

	it('rejects a non-table [services.postgres] section', () => {
		const validation = validatePostgresService('embedded')

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toEqual([
			'[services.postgres] must be a table',
		])
	})

	it('rejects an unknown mode value', () => {
		const validation = validatePostgresService({ mode: 'managed' })

		expect(validation.ok).toBe(false)
		if (validation.ok) return
		expect(validation.errors).toContain(
			'services.postgres.mode must be one of: embedded, external',
		)
	})
})
