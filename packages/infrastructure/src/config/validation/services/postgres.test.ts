import { describe, expect, it } from 'vitest'

import { validatePostgresService } from './postgres.ts'

describe('validatePostgresService', () => {
	it('parses a valid embedded config', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			version: '17.2',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section).toEqual({
			mode: 'embedded',
			version: '17.2',
			migrationsFolder: undefined,
		})
	})

	it('parses an explicit migrations_folder override', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			version: '17.2',
			migrations_folder: 'src/db/migrations',
		})

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.section.migrationsFolder).toBe('src/db/migrations')
	})

	it('rejects an empty migrations_folder string', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			version: '17.2',
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
			version: '17.2',
			migrations_folder: 42,
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.postgres.migrations_folder must be a non-empty string when set',
		)
	})

	it('parses a valid external config', () => {
		const result = validatePostgresService({
			mode: 'external',
			version: '16',
		})

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
		const result = validatePostgresService({
			mode: 'managed',
			version: '17',
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.postgres.mode must be one of: embedded, external',
		)
	})

	it('rejects a missing version', () => {
		const result = validatePostgresService({ mode: 'embedded' })

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors).toContain(
			'services.postgres.version must be a non-empty string',
		)
	})

	it('rejects a version that does not match the supported pattern', () => {
		const result = validatePostgresService({
			mode: 'embedded',
			version: 'latest',
		})

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(
			result.errors.some(e =>
				e.startsWith('services.postgres.version "latest"'),
			),
		).toBe(true)
	})
})
