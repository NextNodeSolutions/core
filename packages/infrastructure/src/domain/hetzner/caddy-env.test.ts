import { describe, expect, it } from 'vitest'

import type { InfraStorageRuntimeConfig } from '@/domain/cloudflare/r2/runtime-config.ts'

import { CADDY_ENV_PATH, renderCaddyEnv } from './caddy-env.ts'

const STORAGE: InfraStorageRuntimeConfig = {
	accountId: 'account-123',
	accessKeyId: 'AKID',
	secretAccessKey: 'SECRET',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
	endpoint: 'https://account-123.r2.cloudflarestorage.com',
}

describe('renderCaddyEnv', () => {
	it('targets /etc/caddy/env', () => {
		expect(CADDY_ENV_PATH).toBe('/etc/caddy/env')
	})

	it('emits KEY=value lines for R2 secret and CF API token', () => {
		expect(
			renderCaddyEnv({
				infraStorage: STORAGE,
				cloudflareApiToken: 'cf-token',
			}),
		).toBe('CADDY_R2_SECRET_KEY=SECRET\nCF_DNS_API_TOKEN=cf-token')
	})

	it('rejects R2 secret values containing newlines', () => {
		expect(() =>
			renderCaddyEnv({
				infraStorage: { ...STORAGE, secretAccessKey: 'SECRET\nINJECT' },
				cloudflareApiToken: 'cf-token',
			}),
		).toThrow(/contains a newline/)
	})

	it('rejects CF tokens containing newlines', () => {
		expect(() =>
			renderCaddyEnv({
				infraStorage: STORAGE,
				cloudflareApiToken: 'cf-token\nINJECT',
			}),
		).toThrow(/contains a newline/)
	})
})
