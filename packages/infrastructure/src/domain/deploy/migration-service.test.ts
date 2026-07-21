import { describe, expect, it } from 'vitest'

import {
	resolveD1MigrationServiceName,
	resolveMigrationServiceName,
} from './migration-service.ts'

import type { UserServiceConfig, WorkerServiceConfig } from '#/config/types.ts'

const service = (needs: string[]): UserServiceConfig => ({
	port: 3000,
	secrets: [],
	needs,
	dependsOn: [],
	source: 'build',
	target: 'app',
})

const worker = (needs: string[]): WorkerServiceConfig => ({
	secrets: [],
	needs,
	dependsOn: [],
	entry: 'dist/_worker.js/index.js',
})

describe('resolveMigrationServiceName', () => {
	it('returns the sole service that declares needs = ["postgres"]', () => {
		const name = resolveMigrationServiceName({
			front: service([]),
			api: service(['postgres']),
		})

		expect(name).toBe('api')
	})

	it('throws when no service declares needs = ["postgres"]', () => {
		expect(() =>
			resolveMigrationServiceName({
				front: service([]),
				api: service([]),
			}),
		).toThrow(/No deploy service declares needs = \["postgres"\]/)
	})

	it('throws when more than one service declares needs = ["postgres"]', () => {
		expect(() =>
			resolveMigrationServiceName({
				front: service(['postgres']),
				api: service(['postgres']),
			}),
		).toThrow(
			'Multiple deploy services declare needs = ["postgres"] (front, api) - only one can own the migration of the single project database; declare needs = ["postgres"] on the schema owner alone',
		)
	})
})

describe('resolveD1MigrationServiceName', () => {
	it('returns the first service (declaration order) that declares needs = ["d1"]', () => {
		const name = resolveD1MigrationServiceName({
			web: worker([]),
			api: worker(['d1']),
			admin: worker(['d1']),
		})

		expect(name).toBe('api')
	})

	it('permits multiple D1 consumers (no ambiguity error, unlike postgres)', () => {
		const name = resolveD1MigrationServiceName({
			api: worker(['d1']),
			admin: worker(['d1']),
		})

		expect(name).toBe('api')
	})

	it('throws when no service declares needs = ["d1"]', () => {
		expect(() =>
			resolveD1MigrationServiceName({
				web: worker([]),
				api: worker([]),
			}),
		).toThrow(/No deploy service declares needs = \["d1"\]/)
	})
})
