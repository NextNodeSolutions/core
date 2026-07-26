import { APP_WITH_DOMAIN, WORKERS_APP_WITH_DOMAIN } from '#/cli/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	buildDeployInput,
	resolveDeployContext,
} from './resolve-deploy-context.ts'

import type { DeployableConfig, UserServiceConfig } from '#/config/types.ts'

// Throws the exact error the real module raises when the R2 credentials are
// absent from the env, so any reintroduced call site fails the test loudly.
vi.mock(import('#/cli/r2/load-runtime.ts'), () => ({
	loadR2Runtime: vi.fn(() => {
		throw new Error('R2_ACCESS_KEY_ID env var is required')
	}),
}))

vi.mock('../../adapters/cloudflare/workers/target.ts', () => ({
	CloudflareWorkersTarget: vi.fn(() => ({
		name: 'cloudflare-workers',
		contributeEnv: () => ({
			public: { SITE_URL: 'https://example.com' },
			secret: {},
		}),
		loadBackingEnv: async () => ({
			public: { R2_BUCKET_MEDIAS_URL: 'https://medias.cdn.example.com' },
			secret: {},
		}),
	})),
}))

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

const WORKERS_APP_WITH_R2_AND_D1: DeployableConfig = {
	...WORKERS_APP_WITH_DOMAIN,
	services: {
		d1: { migrationsFolder: 'drizzle' },
		r2: { buckets: [{ name: 'medias', cdn: true }] },
	},
}

describe('resolveDeployContext on the cloudflare-workers target', () => {
	beforeEach(() => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('TF_TOKEN_app_terraform_io', 'tf-token')
		vi.stubEnv('GITHUB_REPOSITORY', 'NextNodeSolutions/studiobymina')
		vi.stubEnv('ALL_SECRETS', JSON.stringify({}))
		vi.stubEnv('R2_ACCESS_KEY_ID', '')
		vi.stubEnv('R2_SECRET_ACCESS_KEY', '')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	// Terraform realises the buckets and holds their state in the HCP workspace,
	// so no S3 credential is ever consumed. Requiring one killed `migrate-remote`
	// and `deploy` on every project that declared a bucket.
	it('resolves a config declaring [services.r2] without any R2 credential', async () => {
		const context = await resolveDeployContext(WORKERS_APP_WITH_R2_AND_D1)

		expect(context.infraStorage).toBeNull()
		expect(context.env['SITE_URL']).toBe('https://example.com')
	})
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
