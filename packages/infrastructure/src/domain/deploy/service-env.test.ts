import { describe, expect, it } from 'vitest'

import { buildServiceSecretEnv, buildServiceUrlEnv } from './service-env.ts'

import type { UserServiceConfig } from '#/config/types.ts'

const buildService = (url?: string): UserServiceConfig => ({
	port: 3000,
	...(url !== undefined && { url }),
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'build',
	target: 'app',
})

const service = (
	opts: { secrets?: string[]; needs?: string[] } = {},
): UserServiceConfig => ({
	port: 3000,
	secrets: opts.secrets ?? [],
	needs: opts.needs ?? [],
	dependsOn: [],
	source: 'build',
	target: 'app',
})

describe('buildServiceUrlEnv', () => {
	it('maps each url service to <NAME>_URL with its https-prefixed url', () => {
		expect(
			buildServiceUrlEnv(
				{
					front: buildService('example.com'),
					api: buildService('api.example.com'),
				},
				'production',
			),
		).toEqual({
			FRONT_URL: 'https://example.com',
			API_URL: 'https://api.example.com',
		})
	})

	it('resolves each url to its dev hostname in development', () => {
		expect(
			buildServiceUrlEnv(
				{
					front: buildService('example.com'),
					api: buildService('api.example.com'),
				},
				'development',
			),
		).toEqual({
			FRONT_URL: 'https://dev.example.com',
			API_URL: 'https://dev.api.example.com',
		})
	})

	it('upper-snake-cases kebab service names into env var keys', () => {
		expect(
			buildServiceUrlEnv(
				{ 'admin-api': buildService('admin.example.com') },
				'production',
			),
		).toEqual({ ADMIN_API_URL: 'https://admin.example.com' })
	})

	it('omits services that declare no url', () => {
		expect(
			buildServiceUrlEnv(
				{
					front: buildService('example.com'),
					worker: buildService(),
				},
				'production',
			),
		).toEqual({ FRONT_URL: 'https://example.com' })
	})

	it('returns an empty map when no service declares a url', () => {
		expect(
			buildServiceUrlEnv(
				{
					worker: buildService(),
					cron: buildService(),
				},
				'production',
			),
		).toEqual({})
	})

	it('returns an empty map for an empty service set', () => {
		expect(buildServiceUrlEnv({}, 'production')).toEqual({})
	})
})

describe('buildServiceSecretEnv', () => {
	it('projects a user secret only to the services that declare it', () => {
		expect(
			buildServiceSecretEnv(
				{
					front: service({ secrets: ['SESSION_KEY'] }),
					api: service({ secrets: ['JWT_SECRET'] }),
				},
				{ SESSION_KEY: 'sess-val', JWT_SECRET: 'jwt-val' },
				{},
			),
		).toEqual({
			front: { SESSION_KEY: 'sess-val' },
			api: { JWT_SECRET: 'jwt-val' },
		})
	})

	it('projects a backing secret only to services that declare needs on its producer (no broadcast)', () => {
		expect(
			buildServiceSecretEnv(
				{
					front: service({ needs: [] }),
					api: service({ needs: ['postgres'] }),
				},
				{ DATABASE_URL: 'postgres://db:5432' },
				{ DATABASE_URL: 'postgres' },
			),
		).toEqual({
			// front declares no needs → never receives the postgres DATABASE_URL
			front: {},
			api: { DATABASE_URL: 'postgres://db:5432' },
		})
	})

	it('withholds a backing secret from a sibling that needs a different service', () => {
		expect(
			buildServiceSecretEnv(
				{
					api: service({ needs: ['postgres'] }),
					assets: service({ needs: ['r2'] }),
				},
				{
					DATABASE_URL: 'postgres://db:5432',
					R2_ACCESS_KEY_ID: 'r2-key',
				},
				{ DATABASE_URL: 'postgres', R2_ACCESS_KEY_ID: 'r2' },
			),
		).toEqual({
			api: { DATABASE_URL: 'postgres://db:5432' },
			assets: { R2_ACCESS_KEY_ID: 'r2-key' },
		})
	})

	it('combines a needs-projected backing secret with a declared user secret', () => {
		expect(
			buildServiceSecretEnv(
				{
					api: service({
						secrets: ['JWT_SECRET'],
						needs: ['postgres'],
					}),
				},
				{ JWT_SECRET: 'jwt-val', DATABASE_URL: 'postgres://db:5432' },
				{ DATABASE_URL: 'postgres' },
			),
		).toEqual({
			api: {
				JWT_SECRET: 'jwt-val',
				DATABASE_URL: 'postgres://db:5432',
			},
		})
	})

	it('omits a declared secret that is absent from the pool values', () => {
		expect(
			buildServiceSecretEnv(
				{ app: service({ secrets: ['SESSION_KEY', 'MISSING'] }) },
				{ SESSION_KEY: 'sess-val' },
				{},
			),
		).toEqual({ app: { SESSION_KEY: 'sess-val' } })
	})

	it('returns an empty map for an empty service set', () => {
		expect(
			buildServiceSecretEnv({}, { SESSION_KEY: 'sess-val' }, {}),
		).toEqual({})
	})
})
