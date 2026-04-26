import { describe, expect, it } from 'vitest'

import { APP_WITH_DOMAIN, STATIC_WITH_DOMAIN } from '@/cli/fixtures.ts'
import type { DeployableConfig } from '@/config/types.ts'
import type { InfraStorageRuntimeConfig } from '@/domain/cloudflare/r2/runtime-config.ts'

import { resolveServices } from './resolve.ts'

const INFRA_STORAGE: InfraStorageRuntimeConfig = {
	accountId: 'acct',
	endpoint: 'https://r2.example.com',
	accessKeyId: 'r2-key',
	secretAccessKey: 'r2-secret',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
}

function withR2Service(
	config: DeployableConfig,
	buckets: ReadonlyArray<string>,
): DeployableConfig {
	return { ...config, services: { r2: { buckets } } }
}

describe('resolveServices', () => {
	it('returns no services when [services] is empty (Pages, no R2)', () => {
		expect(
			resolveServices({
				config: STATIC_WITH_DOMAIN,
				environment: 'production',
				cfToken: 'cf-token',
				infraStorage: null,
			}),
		).toEqual([])
	})

	it('returns no services for Hetzner without [services.r2] (infra storage only used for VPS state)', () => {
		expect(
			resolveServices({
				config: APP_WITH_DOMAIN,
				environment: 'production',
				cfToken: 'cf-token',
				infraStorage: INFRA_STORAGE,
			}),
		).toEqual([])
	})

	it('exposes the R2 service when [services.r2] is declared', () => {
		const services = resolveServices({
			config: withR2Service(STATIC_WITH_DOMAIN, ['uploads', 'media']),
			environment: 'production',
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
		})

		expect(services).toHaveLength(1)
		expect(services[0]?.name).toBe('r2')
	})

	it('throws when [services.r2] is declared but infra storage is missing — invariant broken upstream', () => {
		expect(() =>
			resolveServices({
				config: withR2Service(STATIC_WITH_DOMAIN, ['uploads']),
				environment: 'production',
				cfToken: 'cf-token',
				infraStorage: null,
			}),
		).toThrow(
			'r2 service: infra storage (state bucket) must be loaded by the caller — caller invariant broken',
		)
	})
})
