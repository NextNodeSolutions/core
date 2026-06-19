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

// The two layered caches every build target carries: the fast-but-evictable gha
// scope and the durable GHCR registry buildcache. Encoded once here (the
// expected contract) so a fixture reads as "this target, with the standard
// cache block"; the cache string format itself is pinned literally by the
// dedicated test below.
const cacheBlock = (
	name: string,
	cacheRef: string,
): {
	'cache-from': ReadonlyArray<string>
	'cache-to': ReadonlyArray<string>
} => ({
	'cache-from': [
		`type=gha,scope=${name}`,
		`type=registry,ref=${cacheRef}:buildcache`,
	],
	'cache-to': [
		`type=gha,scope=${name},mode=max`,
		`type=registry,ref=${cacheRef}:buildcache,mode=max,ignore-error=true`,
	],
})

describe('renderBakeFile', () => {
	it('renders a build service with monorepo defaults: repo-root context, package Dockerfile, no explicit stage', () => {
		const bakeFile = renderBakeFile({
			services: { app: buildService() },
			imageRefs: { app: APP_IMAGE },
			bakeTargets: ['app'],
			packageDir: 'packages/monitoring',
			buildArgs: {},
		})

		expect(parse(bakeFile)).toEqual({
			group: { default: { targets: ['app'] } },
			target: {
				app: {
					context: '.',
					dockerfile: 'packages/monitoring/Dockerfile',
					tags: ['ghcr.io/nextnodesolutions/core-app:sha-abc1234'],
					...cacheBlock('app', 'ghcr.io/nextnodesolutions/core-app'),
				},
			},
		})
	})

	it('honors explicit context, dockerfile, and build stage from the service config', () => {
		const bakeFile = renderBakeFile({
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
			buildArgs: {},
		})

		expect(parse(bakeFile)).toEqual({
			group: { default: { targets: ['web'] } },
			target: {
				web: {
					context: 'apps/web',
					dockerfile: 'apps/web/Dockerfile.prod',
					target: 'runtime',
					tags: ['ghcr.io/acme/site-web:sha-deadbee'],
					...cacheBlock('web', 'ghcr.io/acme/site-web'),
				},
			},
		})
	})

	it('defaults the Dockerfile to the repo root when the package dir is empty', () => {
		const bakeFile = renderBakeFile({
			services: { app: buildService() },
			imageRefs: { app: APP_IMAGE },
			bakeTargets: ['app'],
			packageDir: '',
			buildArgs: {},
		})

		expect(parse(bakeFile)).toEqual({
			group: { default: { targets: ['app'] } },
			target: {
				app: {
					context: '.',
					dockerfile: 'Dockerfile',
					tags: ['ghcr.io/nextnodesolutions/core-app:sha-abc1234'],
					...cacheBlock('app', 'ghcr.io/nextnodesolutions/core-app'),
				},
			},
		})
	})

	it('emits resolved build args on the target, leaving arg-less targets untouched', () => {
		const bakeFile = renderBakeFile({
			services: { front: buildService(), api: buildService() },
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
			},
			bakeTargets: ['front', 'api'],
			packageDir: 'packages/app',
			buildArgs: {
				front: {
					SITE_URL: 'https://example.com',
					ANALYTICS_ID: 'GA-1',
				},
			},
		})

		expect(parse(bakeFile)).toEqual({
			group: { default: { targets: ['front', 'api'] } },
			target: {
				front: {
					context: '.',
					dockerfile: 'packages/app/Dockerfile',
					args: {
						SITE_URL: 'https://example.com',
						ANALYTICS_ID: 'GA-1',
					},
					tags: ['ghcr.io/acme/app-front:sha-1111111'],
					...cacheBlock('front', 'ghcr.io/acme/app-front'),
				},
				api: {
					context: '.',
					dockerfile: 'packages/app/Dockerfile',
					tags: ['ghcr.io/acme/app-api:sha-2222222'],
					...cacheBlock('api', 'ghcr.io/acme/app-api'),
				},
			},
		})
	})

	it('omits the args key when a target maps to an empty build-arg record', () => {
		const bakeFile = renderBakeFile({
			services: { app: buildService() },
			imageRefs: { app: APP_IMAGE },
			bakeTargets: ['app'],
			packageDir: 'packages/monitoring',
			buildArgs: { app: {} },
		})

		expect(parse(bakeFile)).toEqual({
			group: { default: { targets: ['app'] } },
			target: {
				app: {
					context: '.',
					dockerfile: 'packages/monitoring/Dockerfile',
					tags: ['ghcr.io/nextnodesolutions/core-app:sha-abc1234'],
					...cacheBlock('app', 'ghcr.io/nextnodesolutions/core-app'),
				},
			},
		})
	})

	it('bakes only the build services in bakeTargets order and excludes upstream services', () => {
		const bakeFile = renderBakeFile({
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
			buildArgs: {},
		})

		expect(parse(bakeFile)).toEqual({
			group: { default: { targets: ['front', 'api'] } },
			target: {
				front: {
					context: '.',
					dockerfile: 'packages/app/Dockerfile',
					tags: ['ghcr.io/acme/app-front:sha-1111111'],
					...cacheBlock('front', 'ghcr.io/acme/app-front'),
				},
				api: {
					context: '.',
					dockerfile: 'packages/app/Dockerfile',
					tags: ['ghcr.io/acme/app-api:sha-2222222'],
					...cacheBlock('api', 'ghcr.io/acme/app-api'),
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
				buildArgs: {},
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
				buildArgs: {},
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
				buildArgs: {},
			}),
		).toThrow('bake target "app" is not a declared build service')
	})

	it('carries a GHCR registry buildcache ref alongside the per-target gha cache', () => {
		const bakeFile = renderBakeFile({
			services: { app: buildService() },
			imageRefs: { app: APP_IMAGE },
			bakeTargets: ['app'],
			packageDir: 'packages/monitoring',
			buildArgs: {},
		})

		expect(parse(bakeFile)).toMatchObject({
			target: {
				app: {
					'cache-from': [
						'type=gha,scope=app',
						'type=registry,ref=ghcr.io/nextnodesolutions/core-app:buildcache',
					],
					'cache-to': [
						'type=gha,scope=app,mode=max',
						'type=registry,ref=ghcr.io/nextnodesolutions/core-app:buildcache,mode=max,ignore-error=true',
					],
				},
			},
		})
	})
})
