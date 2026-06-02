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

const serviceWithSecrets = (secrets: string[]): UserServiceConfig => ({
	port: 3000,
	secrets,
	needs: [],
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
	it('projects the pool through each service so it gets only its declared subset', () => {
		expect(
			buildServiceSecretEnv(
				{
					front: serviceWithSecrets(['SESSION_KEY']),
					api: serviceWithSecrets(['JWT_SECRET']),
				},
				{ SESSION_KEY: 'sess-val', JWT_SECRET: 'jwt-val' },
			),
		).toEqual({
			front: { SESSION_KEY: 'sess-val' },
			api: { JWT_SECRET: 'jwt-val' },
		})
	})

	it('broadcasts a secret no service claims (service-required, e.g. DATABASE_URL)', () => {
		expect(
			buildServiceSecretEnv(
				{
					front: serviceWithSecrets(['SESSION_KEY']),
					api: serviceWithSecrets(['JWT_SECRET']),
				},
				{
					SESSION_KEY: 'sess-val',
					JWT_SECRET: 'jwt-val',
					DATABASE_URL: 'postgres://db:5432',
				},
			),
		).toEqual({
			front: {
				SESSION_KEY: 'sess-val',
				DATABASE_URL: 'postgres://db:5432',
			},
			api: { JWT_SECRET: 'jwt-val', DATABASE_URL: 'postgres://db:5432' },
		})
	})

	it('gives a service that declares no secrets only the broadcast set', () => {
		expect(
			buildServiceSecretEnv(
				{
					app: serviceWithSecrets(['SESSION_KEY']),
					worker: serviceWithSecrets([]),
				},
				{ SESSION_KEY: 'sess-val', DATABASE_URL: 'postgres://db:5432' },
			),
		).toEqual({
			app: {
				SESSION_KEY: 'sess-val',
				DATABASE_URL: 'postgres://db:5432',
			},
			worker: { DATABASE_URL: 'postgres://db:5432' },
		})
	})

	it('omits a declared secret that is absent from the pool values', () => {
		expect(
			buildServiceSecretEnv(
				{ app: serviceWithSecrets(['SESSION_KEY', 'MISSING']) },
				{ SESSION_KEY: 'sess-val' },
			),
		).toEqual({ app: { SESSION_KEY: 'sess-val' } })
	})

	it('returns an empty map for an empty service set', () => {
		expect(buildServiceSecretEnv({}, { SESSION_KEY: 'sess-val' })).toEqual(
			{},
		)
	})
})
