import { describe, expect, it } from 'vitest'

import { buildServiceUpstreams } from './service-upstreams.ts'

import type { UserServiceConfig } from '#/config/types.ts'

const routedService = (url: string): UserServiceConfig => ({
	port: 3000,
	url,
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'build',
	target: 'app',
})

const internalService = (): UserServiceConfig => ({
	port: 3000,
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'build',
	target: 'worker',
})

describe('buildServiceUpstreams', () => {
	it('emits one upstream per service that declares a url, dialing its host port', () => {
		const upstreams = buildServiceUpstreams(
			{
				front: routedService('example.com'),
				api: routedService('api.example.com'),
			},
			{ front: 8080, api: 8081 },
		)

		expect(upstreams).toEqual([
			{ hostname: 'example.com', dial: 'localhost:8080' },
			{ hostname: 'api.example.com', dial: 'localhost:8081' },
		])
	})

	it('excludes services that declare no url (internal-only workloads)', () => {
		const upstreams = buildServiceUpstreams(
			{
				front: routedService('example.com'),
				worker: internalService(),
			},
			{ front: 8080, worker: 8081 },
		)

		expect(upstreams).toEqual([
			{ hostname: 'example.com', dial: 'localhost:8080' },
		])
	})

	it('returns no upstreams when no service declares a url', () => {
		const upstreams = buildServiceUpstreams(
			{ worker: internalService() },
			{ worker: 8080 },
		)

		expect(upstreams).toEqual([])
	})

	it('throws when a service declares a url but has no allocated host port', () => {
		expect(() =>
			buildServiceUpstreams({ front: routedService('example.com') }, {}),
		).toThrow(
			'No host port allocated for routed service "front" (url "example.com"); every service declaring a url needs an allocated host port',
		)
	})
})
