import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCloudflareWorkersTarget } from './create-cloudflare-workers-target.ts'

import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'

vi.mock('../../adapters/cloudflare/workers/target.ts', () => ({
	CloudflareWorkersTarget: vi.fn(),
}))

const WORKERS_CONFIG: CloudflareWorkersDeployableConfig = {
	project: {
		name: 'acme-worker',
		type: 'app',
		filter: false,
		domain: 'acme-worker.example.com',
		redirectDomains: [],
		internal: false,
	},
	scripts: { lint: false, test: false, build: false },
	package: false,
	environment: { development: true },
	deploy: {
		target: 'cloudflare-workers',
		secrets: [],
		generatedSecrets: [],
		vps: null,
		volumes: [],
		services: {},
		cron: [],
	},
	services: {},
}

beforeEach(() => {
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('createCloudflareWorkersTarget', () => {
	it('wires the account id, HCP token, project dir, environment, and config into the target', async () => {
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('TF_TOKEN_app_terraform_io', 'tf-token')
		vi.stubEnv('GITHUB_WORKSPACE', '/workspace')
		vi.stubEnv('PIPELINE_CONFIG_FILE', 'apps/web/nextnode.toml')

		const { CloudflareWorkersTarget } =
			await import('#/adapters/cloudflare/workers/target.ts')

		createCloudflareWorkersTarget(WORKERS_CONFIG, 'production')

		expect(CloudflareWorkersTarget).toHaveBeenCalledWith({
			accountId: 'acct-123',
			hcpToken: 'tf-token',
			projectDir: '/workspace/apps/web',
			environment: 'production',
			config: WORKERS_CONFIG,
		})
	})

	it('throws when CLOUDFLARE_API_TOKEN is missing', () => {
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('TF_TOKEN_app_terraform_io', 'tf-token')

		expect(() =>
			createCloudflareWorkersTarget(WORKERS_CONFIG, 'production'),
		).toThrow('CLOUDFLARE_API_TOKEN env var is required')
	})

	it('throws when CLOUDFLARE_ACCOUNT_ID is missing', () => {
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('TF_TOKEN_app_terraform_io', 'tf-token')

		expect(() =>
			createCloudflareWorkersTarget(WORKERS_CONFIG, 'production'),
		).toThrow('CLOUDFLARE_ACCOUNT_ID env var is required')
	})

	it('throws when TF_TOKEN_app_terraform_io is missing', () => {
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')

		expect(() =>
			createCloudflareWorkersTarget(WORKERS_CONFIG, 'production'),
		).toThrow('TF_TOKEN_app_terraform_io env var is required')
	})
})
