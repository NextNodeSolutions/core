import { describe, expect, it } from 'vitest'

import { resolveMigrationServiceName } from './migration-service.ts'

import type { UserServiceConfig } from '#/config/types.ts'

const service = (needs: string[]): UserServiceConfig => ({
	port: 3000,
	secrets: [],
	needs,
	dependsOn: [],
	source: 'build',
	target: 'app',
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
			'Multiple deploy services declare needs = ["postgres"] (front, api) — only one can own the migration of the single project database; declare needs = ["postgres"] on the schema owner alone',
		)
	})
})
