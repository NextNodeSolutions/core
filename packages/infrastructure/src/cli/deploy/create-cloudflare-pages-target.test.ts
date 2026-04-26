import type { CloudflarePagesDeployableConfig } from '#/config/types.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCloudflarePagesTarget } from './create-cloudflare-pages-target.ts'

vi.mock('../../adapters/cloudflare/target.ts', () => ({
	CloudflarePagesTarget: vi.fn(),
}))

const STATIC_CONFIG: CloudflarePagesDeployableConfig = {
	project: {
		name: 'acme-site',
		type: 'static',
		filter: false,
		domain: 'acme-site.example.com',
		redirectDomains: ['www.example.com'],
		internal: false,
	},
	scripts: { lint: false, test: false, build: false },
	package: false,
	environment: { development: true },
	deploy: {
		target: 'cloudflare-pages',
		secrets: [],
		vps: null,
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

describe('createCloudflarePagesTarget', () => {
	it('wires Cloudflare credentials from env into the target config', async () => {
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')

		const { CloudflarePagesTarget } =
			await import('#/adapters/cloudflare/target.ts')

		createCloudflarePagesTarget(STATIC_CONFIG, 'production')

		expect(CloudflarePagesTarget).toHaveBeenCalledWith({
			accountId: 'acct-123',
			token: 'cf-token',
			environment: 'production',
			domain: 'acme-site.example.com',
			redirectDomains: ['www.example.com'],
		})
	})

	it('throws when CLOUDFLARE_ACCOUNT_ID is missing', () => {
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')

		expect(() =>
			createCloudflarePagesTarget(STATIC_CONFIG, 'production'),
		).toThrow('CLOUDFLARE_ACCOUNT_ID env var is required')
	})

	it('throws when CLOUDFLARE_API_TOKEN is missing', () => {
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')

		expect(() =>
			createCloudflarePagesTarget(STATIC_CONFIG, 'production'),
		).toThrow('CLOUDFLARE_API_TOKEN env var is required')
	})
})
