import { describe, expect, it } from 'vitest'

import {
	decideMigrationsChanged,
	resolveMigrationsFolder,
} from './migrations-changed.ts'

import type {
	PostgresServiceConfig,
	ServicesConfig,
} from '#/config/service-config.ts'

const embedded = (
	extra: Partial<PostgresServiceConfig> = {},
): ServicesConfig => ({ postgres: { mode: 'embedded', ...extra } })

describe('resolveMigrationsFolder', () => {
	it('defaults to "drizzle" (drizzle-kit\'s own default) when postgres declares no folder', () => {
		expect(resolveMigrationsFolder(embedded())).toBe('drizzle')
	})

	it('defaults to "drizzle" when no database service is declared', () => {
		expect(resolveMigrationsFolder({})).toBe('drizzle')
	})

	it('honors an explicit postgres migrationsFolder override', () => {
		expect(
			resolveMigrationsFolder(
				embedded({ migrationsFolder: 'src/db/migrations' }),
			),
		).toBe('src/db/migrations')
	})

	it('reads the folder from [services.d1] when the project declares D1', () => {
		expect(
			resolveMigrationsFolder({ d1: { migrationsFolder: 'drizzle/d1' } }),
		).toBe('drizzle/d1')
	})
})

describe('decideMigrationsChanged', () => {
	it('reports changed when a file under the migrations folder changed', () => {
		const decision = decideMigrationsChanged(
			{
				kind: 'paths',
				changedPaths: ['src/app.ts', 'drizzle/0001_init.sql'],
			},
			'drizzle',
		)

		expect(decision.changed).toBe(true)
	})

	it('reports unchanged when no changed file is under the migrations folder', () => {
		const decision = decideMigrationsChanged(
			{ kind: 'paths', changedPaths: ['src/app.ts', 'README.md'] },
			'drizzle',
		)

		expect(decision.changed).toBe(false)
	})

	it('does not match a sibling folder that merely shares the name as a prefix', () => {
		const decision = decideMigrationsChanged(
			{ kind: 'paths', changedPaths: ['drizzle-archive/old.sql'] },
			'drizzle',
		)

		expect(decision.changed).toBe(false)
	})

	it('matches the migrations folder under a custom path', () => {
		const decision = decideMigrationsChanged(
			{ kind: 'paths', changedPaths: ['src/db/migrations/0002.sql'] },
			'src/db/migrations',
		)

		expect(decision.changed).toBe(true)
	})

	it('fails safe to changed=true when the diff is undiffable (manual dispatch, missing base)', () => {
		const decision = decideMigrationsChanged(
			{
				kind: 'undiffable',
				reason: 'event "workflow_dispatch" is not a push',
			},
			'drizzle',
		)

		expect(decision.changed).toBe(true)
		expect(decision.reason).toContain('workflow_dispatch')
	})
})
