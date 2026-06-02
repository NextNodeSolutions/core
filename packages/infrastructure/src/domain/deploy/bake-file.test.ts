import { parseJsonOrThrow } from '#/kernel/json.ts'
import { describe, expect, it } from 'vitest'

import { renderBakeFile } from './bake-file.ts'

import type { UserServiceConfig } from '#/config/types.ts'
import type { ImageRef } from './target.ts'

const APP_IMAGE: ImageRef = {
	registry: 'ghcr.io',
	repository: 'nextnodesolutions/core-app',
	tag: 'sha-abc1234',
}

const buildService = (
	extra: { context?: string; dockerfile?: string; target?: string } = {},
): UserServiceConfig => ({
	port: 3000,
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'build',
	...extra,
})

const upstreamService = (ref: string): UserServiceConfig => ({
	port: 3000,
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'upstream',
	ref,
})

const parse = (raw: string): unknown => parseJsonOrThrow(raw, 'bake definition')

describe('renderBakeFile', () => {
	it('renders a build service with monorepo defaults: repo-root context, package Dockerfile, no explicit stage', () => {
		const result = renderBakeFile({
			services: { app: buildService() },
			imageRefs: { app: APP_IMAGE },
			bakeTargets: ['app'],
			packageDir: 'packages/monitoring',
		})

		expect(parse(result)).toEqual({
			group: { default: { targets: ['app'] } },
			target: {
				app: {
					context: '.',
					dockerfile: 'packages/monitoring/Dockerfile',
					tags: ['ghcr.io/nextnodesolutions/core-app:sha-abc1234'],
					'cache-from': ['type=gha,scope=app'],
					'cache-to': ['type=gha,scope=app,mode=max'],
				},
			},
		})
	})

	it('honors explicit context, dockerfile, and build stage from the service config', () => {
		const result = renderBakeFile({
			services: {
				web: buildService({
					context: 'apps/web',
					dockerfile: 'apps/web/Dockerfile.prod',
					target: 'runtime',
				}),
			},
			imageRefs: {
				web: {
					registry: 'ghcr.io',
					repository: 'acme/site-web',
					tag: 'sha-deadbee',
				},
			},
			bakeTargets: ['web'],
			packageDir: 'apps/web',
		})

		expect(parse(result)).toEqual({
			group: { default: { targets: ['web'] } },
			target: {
				web: {
					context: 'apps/web',
					dockerfile: 'apps/web/Dockerfile.prod',
					target: 'runtime',
					tags: ['ghcr.io/acme/site-web:sha-deadbee'],
					'cache-from': ['type=gha,scope=web'],
					'cache-to': ['type=gha,scope=web,mode=max'],
				},
			},
		})
	})

	it('defaults the Dockerfile to the repo root when the package dir is empty', () => {
		const result = renderBakeFile({
			services: { app: buildService() },
			imageRefs: { app: APP_IMAGE },
			bakeTargets: ['app'],
			packageDir: '',
		})

		expect(parse(result)).toEqual({
			group: { default: { targets: ['app'] } },
			target: {
				app: {
					context: '.',
					dockerfile: 'Dockerfile',
					tags: ['ghcr.io/nextnodesolutions/core-app:sha-abc1234'],
					'cache-from': ['type=gha,scope=app'],
					'cache-to': ['type=gha,scope=app,mode=max'],
				},
			},
		})
	})

	it('bakes only the build services in bakeTargets order and excludes upstream services', () => {
		const result = renderBakeFile({
			services: {
				front: buildService(),
				api: buildService(),
				worker: upstreamService('docker.io/acme/worker:2.0'),
			},
			imageRefs: {
				front: {
					registry: 'ghcr.io',
					repository: 'acme/app-front',
					tag: 'sha-1111111',
				},
				api: {
					registry: 'ghcr.io',
					repository: 'acme/app-api',
					tag: 'sha-2222222',
				},
				worker: {
					registry: 'docker.io',
					repository: 'acme/worker',
					tag: '2.0',
				},
			},
			bakeTargets: ['front', 'api'],
			packageDir: 'packages/app',
		})

		expect(parse(result)).toEqual({
			group: { default: { targets: ['front', 'api'] } },
			target: {
				front: {
					context: '.',
					dockerfile: 'packages/app/Dockerfile',
					tags: ['ghcr.io/acme/app-front:sha-1111111'],
					'cache-from': ['type=gha,scope=front'],
					'cache-to': ['type=gha,scope=front,mode=max'],
				},
				api: {
					context: '.',
					dockerfile: 'packages/app/Dockerfile',
					tags: ['ghcr.io/acme/app-api:sha-2222222'],
					'cache-from': ['type=gha,scope=api'],
					'cache-to': ['type=gha,scope=api,mode=max'],
				},
			},
		})
	})

	it('throws when there are no build services to bake', () => {
		expect(() =>
			renderBakeFile({
				services: {},
				imageRefs: {},
				bakeTargets: [],
				packageDir: 'packages/app',
			}),
		).toThrow('no build services to bake')
	})

	it('throws when a bake target has no resolved image ref', () => {
		expect(() =>
			renderBakeFile({
				services: { app: buildService() },
				imageRefs: {},
				bakeTargets: ['app'],
				packageDir: 'packages/app',
			}),
		).toThrow('bake target "app" has no resolved image ref')
	})

	it('throws when a bake target is not a declared build service', () => {
		expect(() =>
			renderBakeFile({
				services: { app: upstreamService('docker.io/acme/app:1.0') },
				imageRefs: { app: APP_IMAGE },
				bakeTargets: ['app'],
				packageDir: 'packages/app',
			}),
		).toThrow('bake target "app" is not a declared build service')
	})
})
