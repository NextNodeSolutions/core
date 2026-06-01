import { describe, expect, it } from 'vitest'

import { buildServiceUrlEnv } from './service-env.ts'

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

describe('buildServiceUrlEnv', () => {
	it('maps each url service to <NAME>_URL with its declared url', () => {
		expect(
			buildServiceUrlEnv({
				front: buildService('example.com'),
				api: buildService('api.example.com'),
			}),
		).toEqual({
			FRONT_URL: 'example.com',
			API_URL: 'api.example.com',
		})
	})

	it('upper-snake-cases kebab service names into env var keys', () => {
		expect(
			buildServiceUrlEnv({
				'admin-api': buildService('admin.example.com'),
			}),
		).toEqual({ ADMIN_API_URL: 'admin.example.com' })
	})

	it('omits services that declare no url', () => {
		expect(
			buildServiceUrlEnv({
				front: buildService('example.com'),
				worker: buildService(),
			}),
		).toEqual({ FRONT_URL: 'example.com' })
	})

	it('returns an empty map when no service declares a url', () => {
		expect(
			buildServiceUrlEnv({
				worker: buildService(),
				cron: buildService(),
			}),
		).toEqual({})
	})

	it('returns an empty map for an empty service set', () => {
		expect(buildServiceUrlEnv({})).toEqual({})
	})
})
