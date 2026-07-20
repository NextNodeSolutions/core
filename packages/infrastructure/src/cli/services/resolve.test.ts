import {
	APP_WITH_DOMAIN,
	STATIC_WITH_DOMAIN,
	WORKERS_APP_WITH_DOMAIN,
} from '#/cli/fixtures.ts'
import { describe, expect, it } from 'vitest'

import { resolveServices } from './resolve.ts'

import type { DeployableConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'

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
	return {
		...config,
		services: {
			r2: { buckets: buckets.map(name => ({ name, cdn: false })) },
		},
	}
}

describe('resolveServices', () => {
	it('returns no services when [services] is empty (Pages, no R2)', () => {
		expect(
			resolveServices({
				config: STATIC_WITH_DOMAIN,
				environment: 'production',
				repository: { owner: 'NextNodeSolutions', name: 'core' },
				cfToken: 'cf-token',
				infraStorage: null,
				repoSecrets: {},
			}),
		).toEqual([])
	})

	it('returns no services for Hetzner without [services.r2] (infra storage only used for VPS state)', () => {
		expect(
			resolveServices({
				config: APP_WITH_DOMAIN,
				environment: 'production',
				repository: { owner: 'NextNodeSolutions', name: 'core' },
				cfToken: 'cf-token',
				infraStorage: INFRA_STORAGE,
				repoSecrets: {},
			}),
		).toEqual([])
	})

	it('exposes the R2 service when [services.r2] is declared', () => {
		const services = resolveServices({
			config: withR2Service(STATIC_WITH_DOMAIN, ['uploads', 'media']),
			environment: 'production',
			repository: { owner: 'NextNodeSolutions', name: 'core' },
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
			repoSecrets: {},
		})

		expect(services).toHaveLength(1)
		expect(services[0]?.name).toBe('r2')
	})

	it('builds the R2 service for a Hetzner config declaring [services.r2] (non-regression)', () => {
		const services = resolveServices({
			config: withR2Service(APP_WITH_DOMAIN, ['uploads']),
			environment: 'production',
			repository: { owner: 'NextNodeSolutions', name: 'core' },
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
			repoSecrets: {},
		})

		expect(services).toHaveLength(1)
		expect(services[0]?.name).toBe('r2')
	})

	it('builds no CLI service for a cloudflare-workers config declaring [services.r2] - R2 is realised by the target Terraform apply', () => {
		expect(
			resolveServices({
				config: withR2Service(WORKERS_APP_WITH_DOMAIN, ['uploads']),
				environment: 'production',
				repository: { owner: 'NextNodeSolutions', name: 'core' },
				cfToken: 'cf-token',
				infraStorage: INFRA_STORAGE,
				repoSecrets: {},
			}),
		).toEqual([])
	})

	it('throws when [services.r2] is declared but infra storage is missing - invariant broken upstream', () => {
		expect(() =>
			resolveServices({
				config: withR2Service(STATIC_WITH_DOMAIN, ['uploads']),
				environment: 'production',
				repository: { owner: 'NextNodeSolutions', name: 'core' },
				cfToken: 'cf-token',
				infraStorage: null,
				repoSecrets: {},
			}),
		).toThrow(
			'r2 service: infra storage (state bucket) must be loaded by the caller - caller invariant broken',
		)
	})

	it('threads infra storage credentials through to the postgres service when declared', () => {
		const configWithPostgres: DeployableConfig = {
			...APP_WITH_DOMAIN,
			services: {
				postgres: {
					mode: 'embedded',
				},
			},
		}

		const services = resolveServices({
			config: configWithPostgres,
			environment: 'production',
			repository: { owner: 'NextNodeSolutions', name: 'core' },
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
			repoSecrets: { POSTGRES_PASSWORD: 's3cret' },
		})

		expect(services).toHaveLength(1)
		expect(services[0]?.name).toBe('postgres')
	})
})
