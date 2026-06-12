import { describe, expect, it } from 'vitest'

import { computePublicBuildArgs, resolveBuildArgs } from './build-args.ts'

import type { UserServiceConfig } from '#/config/types.ts'

const buildService = (
	buildArgs?: ReadonlyArray<string>,
): UserServiceConfig => ({
	port: 3000,
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'build',
	...(buildArgs ? { buildArgs } : {}),
})

const upstreamService = (): UserServiceConfig => ({
	port: 3000,
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'upstream',
	ref: 'docker.io/acme/app:1.0',
})

describe('computePublicBuildArgs', () => {
	it('derives the production SITE_URL from the bare project domain', () => {
		expect(computePublicBuildArgs('example.com', 'production')).toEqual({
			SITE_URL: 'https://example.com',
		})
	})

	it('prefixes the dev subdomain for the development environment', () => {
		expect(computePublicBuildArgs('example.com', 'development')).toEqual({
			SITE_URL: 'https://dev.example.com',
		})
	})
})

describe('resolveBuildArgs', () => {
	const autoArgs = { SITE_URL: 'https://example.com' }

	it('injects the infra auto args into every build service by default', () => {
		const buildArgs = resolveBuildArgs(
			{ front: buildService(), api: buildService() },
			{},
			autoArgs,
		)

		expect(buildArgs).toEqual({
			front: { SITE_URL: 'https://example.com' },
			api: { SITE_URL: 'https://example.com' },
		})
	})

	it('resolves each declared build_arg name against the GitHub Variables map', () => {
		const buildArgs = resolveBuildArgs(
			{ front: buildService(['ANALYTICS_ID', 'FEATURE_X']) },
			{ ANALYTICS_ID: 'GA-1', FEATURE_X: 'on', UNUSED: 'noise' },
			autoArgs,
		)

		expect(buildArgs).toEqual({
			front: {
				SITE_URL: 'https://example.com',
				ANALYTICS_ID: 'GA-1',
				FEATURE_X: 'on',
			},
		})
	})

	it('throws when a declared build_arg is absent from the variables', () => {
		expect(() =>
			resolveBuildArgs(
				{ front: buildService(['ANALYTICS_ID']) },
				{},
				autoArgs,
			),
		).toThrow(
			'service "front" declares build_arg "ANALYTICS_ID" but it is absent from GitHub Variables',
		)
	})

	it('ignores upstream services entirely', () => {
		const buildArgs = resolveBuildArgs(
			{ app: upstreamService() },
			{},
			autoArgs,
		)

		expect(buildArgs).toEqual({})
	})

	it('maps a build service with no args to an empty record (the bake renderer omits the args key)', () => {
		const buildArgs = resolveBuildArgs({ app: buildService() }, {}, {})

		expect(buildArgs).toEqual({ app: {} })
	})
})
