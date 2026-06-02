import { describe, expect, it } from 'vitest'

import {
	computeImageRef,
	parseImageRef,
	parseImageRefsEnv,
	resolveServiceImageRefs,
	selectServiceImage,
} from './image-ref.ts'

import type { UserServiceConfig } from '#/config/types.ts'

const buildService = (target: string): UserServiceConfig => ({
	port: 3000,
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'build',
	target,
})

const upstreamService = (ref: string): UserServiceConfig => ({
	port: 3000,
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'upstream',
	ref,
})

describe('computeImageRef', () => {
	it('normalizes a standard GitHub repository + full sha to a GHCR ref', () => {
		expect(
			computeImageRef({
				repository: 'acme/web',
				sha: 'abc1234567890abcdef1234567890abcdef12345',
			}),
		).toEqual({
			registry: 'ghcr.io',
			repository: 'acme/web',
			tag: 'sha-abc1234',
		})
	})

	it('lowercases owner and repo (GHCR requires lowercase)', () => {
		expect(
			computeImageRef({
				repository: 'NextNodeSolutions/Core',
				sha: 'ABCDEF0123456789',
			}),
		).toEqual({
			registry: 'ghcr.io',
			repository: 'nextnodesolutions/core',
			tag: 'sha-ABCDEF0',
		})
	})

	it('appends the service name to the repository when a service suffix is given', () => {
		expect(
			computeImageRef({
				repository: 'NextNodeSolutions/Core',
				sha: 'abc1234567890',
				service: 'app',
			}),
		).toEqual({
			registry: 'ghcr.io',
			repository: 'nextnodesolutions/core-app',
			tag: 'sha-abc1234',
		})
	})

	it('accepts a sha of exactly 7 chars', () => {
		expect(
			computeImageRef({ repository: 'org/app', sha: '1234567' }),
		).toEqual({
			registry: 'ghcr.io',
			repository: 'org/app',
			tag: 'sha-1234567',
		})
	})

	it('throws when repository has no "/" separator', () => {
		expect(() =>
			computeImageRef({
				repository: 'noslash',
				sha: 'abc1234567890',
			}),
		).toThrow('Invalid repository "noslash": expected "<owner>/<repo>"')
	})

	it('throws when sha is shorter than 7 chars', () => {
		expect(() =>
			computeImageRef({ repository: 'org/app', sha: 'abc123' }),
		).toThrow('Invalid sha "abc123": expected at least 7 chars')
	})

	it('throws on empty sha', () => {
		expect(() =>
			computeImageRef({ repository: 'org/app', sha: '' }),
		).toThrow('Invalid sha "": expected at least 7 chars')
	})
})

describe('parseImageRef', () => {
	it('parses a standard GHCR image ref', () => {
		expect(parseImageRef('ghcr.io/acme/web:sha-abc123')).toEqual({
			registry: 'ghcr.io',
			repository: 'acme/web',
			tag: 'sha-abc123',
		})
	})

	it('parses a registry with a port', () => {
		expect(
			parseImageRef('registry.example.com:5000/org/app:v1.2.3'),
		).toEqual({
			registry: 'registry.example.com:5000',
			repository: 'org/app',
			tag: 'v1.2.3',
		})
	})

	it('parses a deeply nested repository path', () => {
		expect(parseImageRef('ghcr.io/org/team/service:latest')).toEqual({
			registry: 'ghcr.io',
			repository: 'org/team/service',
			tag: 'latest',
		})
	})

	it('throws when tag separator is missing', () => {
		expect(() => parseImageRef('ghcr.io/acme/web')).toThrow(
			'Invalid image ref "ghcr.io/acme/web": missing tag separator ":"',
		)
	})

	it('throws when tag is empty', () => {
		expect(() => parseImageRef('ghcr.io/acme/web:')).toThrow(
			'Invalid image ref "ghcr.io/acme/web:": empty tag',
		)
	})

	it('throws when registry separator is missing', () => {
		expect(() => parseImageRef('noregistry:latest')).toThrow(
			'Invalid image ref "noregistry:latest": missing registry separator "/"',
		)
	})

	it('throws when repository is empty', () => {
		expect(() => parseImageRef('ghcr.io/:tag')).toThrow(
			'Invalid image ref "ghcr.io/:tag": empty repository',
		)
	})

	it('throws on empty string', () => {
		expect(() => parseImageRef('')).toThrow(
			'Invalid image ref "": missing tag separator ":"',
		)
	})

	it.each([
		'ghcr.io; rm -rf /',
		'ghcr.io$(whoami)',
		'ghcr.io`id`',
		'ghcr.io|cat',
		'ghcr.io with space',
	])('rejects registry with shell metacharacters: %s', raw => {
		expect(() => parseImageRef(`${raw}/acme/web:latest`)).toThrow(
			/registry .* must be a hostname/,
		)
	})

	it.each(['acme/web$(id)', 'acme/web;rm', 'acme/UPPER', 'acme//web'])(
		'rejects repository with invalid characters: %s',
		repo => {
			expect(() => parseImageRef(`ghcr.io/${repo}:latest`)).toThrow(
				/repository .* contains invalid characters/,
			)
		},
	)

	it.each(['tag with space', 'tag;rm', 'tag$(id)', 'tag`cmd`', '-leading'])(
		'rejects tag with invalid characters: %s',
		tag => {
			expect(() => parseImageRef(`ghcr.io/acme/web:${tag}`)).toThrow(
				/tag .* contains invalid characters/,
			)
		},
	)
})

describe('resolveServiceImageRefs', () => {
	it('computes a suffixed ref for a build service and marks it a bake target', () => {
		expect(
			resolveServiceImageRefs(
				{ app: buildService('app') },
				'acme/web',
				'abc1234567890',
			),
		).toEqual({
			imageRefs: {
				app: {
					registry: 'ghcr.io',
					repository: 'acme/web-app',
					tag: 'sha-abc1234',
				},
			},
			bakeTargets: ['app'],
		})
	})

	it('keeps an upstream ref verbatim and excludes it from bake targets', () => {
		expect(
			resolveServiceImageRefs(
				{ cache: upstreamService('docker.io/library/redis:7') },
				'acme/web',
				'abc1234567890',
			),
		).toEqual({
			imageRefs: {
				cache: {
					registry: 'docker.io',
					repository: 'library/redis',
					tag: '7',
				},
			},
			bakeTargets: [],
		})
	})

	it('bakes only build services, ordered by declaration', () => {
		const result = resolveServiceImageRefs(
			{
				front: buildService('front'),
				worker: upstreamService('docker.io/acme/worker:2.0'),
				api: buildService('api'),
			},
			'acme/web',
			'abc1234567890',
		)

		expect(result.bakeTargets).toEqual(['front', 'api'])
		expect(result.imageRefs).toEqual({
			front: {
				registry: 'ghcr.io',
				repository: 'acme/web-front',
				tag: 'sha-abc1234',
			},
			worker: {
				registry: 'docker.io',
				repository: 'acme/worker',
				tag: '2.0',
			},
			api: {
				registry: 'ghcr.io',
				repository: 'acme/web-api',
				tag: 'sha-abc1234',
			},
		})
	})

	it('reports no targets for an empty service set', () => {
		expect(
			resolveServiceImageRefs({}, 'acme/web', 'abc1234567890'),
		).toEqual({
			imageRefs: {},
			bakeTargets: [],
		})
	})
})

describe('parseImageRefsEnv', () => {
	it('parses a single-service IMAGE_REFS object into a typed Record', () => {
		expect(
			parseImageRefsEnv(
				'{"app":{"registry":"ghcr.io","repository":"acme/web","tag":"sha-abc123"}}',
			),
		).toEqual({
			app: {
				registry: 'ghcr.io',
				repository: 'acme/web',
				tag: 'sha-abc123',
			},
		})
	})

	it('parses every entry of a multi-service IMAGE_REFS object', () => {
		expect(
			parseImageRefsEnv(
				'{"front":{"registry":"ghcr.io","repository":"acme/web-front","tag":"sha-abc123"},"worker":{"registry":"docker.io","repository":"acme/worker","tag":"2.0"}}',
			),
		).toEqual({
			front: {
				registry: 'ghcr.io',
				repository: 'acme/web-front',
				tag: 'sha-abc123',
			},
			worker: {
				registry: 'docker.io',
				repository: 'acme/worker',
				tag: '2.0',
			},
		})
	})

	it('throws when the value is not valid JSON', () => {
		expect(() => parseImageRefsEnv('not-json')).toThrow(
			'Invalid IMAGE_REFS "not-json": not valid JSON',
		)
	})

	it('throws when the JSON is not an object', () => {
		expect(() => parseImageRefsEnv('["app"]')).toThrow(
			'expected a JSON object of service → image ref',
		)
	})

	it('throws when the object has no entries', () => {
		expect(() => parseImageRefsEnv('{}')).toThrow(
			'at least one service image ref is required',
		)
	})

	it('throws when an entry is missing a string field', () => {
		expect(() =>
			parseImageRefsEnv(
				'{"app":{"registry":"ghcr.io","repository":"acme/web"}}',
			),
		).toThrow(
			'Invalid IMAGE_REFS entry "app": registry, repository and tag must all be strings',
		)
	})

	it('throws when an entry has a malformed ref field', () => {
		expect(() =>
			parseImageRefsEnv(
				'{"app":{"registry":"ghcr.io","repository":"acme/web","tag":"bad tag"}}',
			),
		).toThrow('Invalid image ref')
	})
})

describe('selectServiceImage', () => {
	it('returns the named service image from the Record', () => {
		expect(
			selectServiceImage(
				{
					web: {
						registry: 'ghcr.io',
						repository: 'acme/web',
						tag: 'sha-abc',
					},
				},
				'web',
			),
		).toEqual({
			registry: 'ghcr.io',
			repository: 'acme/web',
			tag: 'sha-abc',
		})
	})

	it('throws naming the missing service when its entry is absent', () => {
		expect(() =>
			selectServiceImage(
				{
					worker: {
						registry: 'docker.io',
						repository: 'acme/worker',
						tag: '2.0',
					},
				},
				'app',
			),
		).toThrow('IMAGE_REFS is missing the "app" service image')
	})
})
