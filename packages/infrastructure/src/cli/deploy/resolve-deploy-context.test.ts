import { APP_WITH_DOMAIN } from '#/cli/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildDeployInput } from './resolve-deploy-context.ts'

import type { DeployableConfig, UserServiceConfig } from '#/config/types.ts'

const VALID_IMAGE_REFS = JSON.stringify({
	app: { registry: 'ghcr.io', repository: 'acme/web', tag: 'sha-abc1234' },
})

const buildService = (target: string): UserServiceConfig => ({
	port: 3000,
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'build',
	target,
})

const upstreamService = (
	ref: string,
	registryAuthSecret?: string,
): UserServiceConfig => ({
	port: 3000,
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'upstream',
	ref,
	...(typeof registryAuthSecret !== 'undefined' && { registryAuthSecret }),
})

const hetznerConfig = (
	services: Record<string, UserServiceConfig>,
): DeployableConfig => ({
	...APP_WITH_DOMAIN,
	project: { ...APP_WITH_DOMAIN.project, domain: 'example.com' },
	deploy: {
		target: 'hetzner-vps',
		cron: [],
		hetzner: { serverType: 'cx23', location: 'nbg1' },
		secrets: [],
		generatedSecrets: [],
		vps: null,
		volumes: [],
		services,
	},
})

describe('buildDeployInput registry token', () => {
	beforeEach(() => {
		vi.stubEnv('IMAGE_REFS', VALID_IMAGE_REFS)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('forwards the GHCR token for a multi-service build deploy', () => {
		vi.stubEnv('GHCR_TOKEN', 'ghs_fake_token')

		const config = hetznerConfig({
			front: buildService('front'),
			api: buildService('api'),
		})

		expect(buildDeployInput(config, {}, {}).registryToken).toBe(
			'ghs_fake_token',
		)
	})

	it('resolves the shared registry_auth_secret for a multi-service upstream deploy', () => {
		const config = hetznerConfig({
			web: upstreamService('docker.io/acme/web:1.0', 'DOCKERHUB_TOKEN'),
			worker: upstreamService(
				'docker.io/acme/worker:1.0',
				'DOCKERHUB_TOKEN',
			),
		})

		const input = buildDeployInput(
			config,
			{},
			{ DOCKERHUB_TOKEN: 'dckr_pat_xyz' },
		)

		expect(input.registryToken).toBe('dckr_pat_xyz')
	})

	it('forwards no token when no upstream service declares a registry_auth_secret', () => {
		const config = hetznerConfig({
			web: upstreamService('docker.io/library/nginx:1.27'),
			cache: upstreamService('docker.io/library/redis:7'),
		})

		expect(buildDeployInput(config, {}, {}).registryToken).toBeUndefined()
	})

	it('throws when upstream services declare distinct registry_auth_secrets', () => {
		const config = hetznerConfig({
			web: upstreamService('docker.io/acme/web:1.0', 'DOCKERHUB_TOKEN'),
			worker: upstreamService('ghcr.io/acme/worker:1.0', 'GHCR_PAT'),
		})

		expect(() =>
			buildDeployInput(
				config,
				{},
				{ DOCKERHUB_TOKEN: 'a', GHCR_PAT: 'b' },
			),
		).toThrow(/multiple distinct registry_auth_secret values/)
	})

	it('throws when the declared registry_auth_secret is absent from GitHub Secrets', () => {
		const config = hetznerConfig({
			web: upstreamService(
				'docker.io/private/app:1.0',
				'DOCKERHUB_TOKEN',
			),
		})

		expect(() => buildDeployInput(config, {}, {})).toThrow(
			'Secret "DOCKERHUB_TOKEN" declared in deploy.services.web.registry_auth_secret but not found in GitHub Secrets',
		)
	})
})
