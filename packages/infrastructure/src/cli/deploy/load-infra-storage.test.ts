import { APP_WITH_DOMAIN, WORKERS_APP_WITH_DOMAIN } from '#/cli/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	ensureInfraStorageForConfig,
	loadInfraStorageForConfig,
} from './load-infra-storage.ts'

import type { DeployableConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'

const RUNTIME: InfraStorageRuntimeConfig = {
	accountId: 'acct-123',
	endpoint: 'https://acct-123.r2.cloudflarestorage.com',
	accessKeyId: 'ak',
	secretAccessKey: 'sk',
	stateBucket: 'state',
	certsBucket: 'certs',
}

const { mockLoadR2Runtime, mockEnsureR2Setup } = vi.hoisted(() => ({
	mockLoadR2Runtime: vi.fn(async () => RUNTIME),
	mockEnsureR2Setup: vi.fn(async () => RUNTIME),
}))

vi.mock('../r2/load-runtime.ts', () => ({ loadR2Runtime: mockLoadR2Runtime }))
vi.mock('../r2/ensure-setup.ts', () => ({ ensureR2Setup: mockEnsureR2Setup }))

const WORKERS_APP_WITH_R2: DeployableConfig = {
	...WORKERS_APP_WITH_DOMAIN,
	services: {
		d1: { migrationsFolder: 'drizzle' },
		r2: { buckets: [{ name: 'medias', cdn: true }] },
	},
}

describe('loadInfraStorageForConfig', () => {
	beforeEach(() => {
		mockLoadR2Runtime.mockClear()
		mockEnsureR2Setup.mockClear()
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('R2_ACCESS_KEY_ID', '')
		vi.stubEnv('R2_SECRET_ACCESS_KEY', '')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	// The cloudflare-workers target realises R2 itself through Terraform (HCP
	// state), so the CLI never consumes the S3 credentials. Loading them anyway
	// made `migrate-remote` and `deploy` die on "R2_ACCESS_KEY_ID env var is
	// required" as soon as a project declared [services.r2].
	it('loads nothing for a cloudflare-workers project declaring [services.r2]', async () => {
		await expect(
			loadInfraStorageForConfig(WORKERS_APP_WITH_R2),
		).resolves.toBeNull()
		expect(mockLoadR2Runtime).not.toHaveBeenCalled()
	})

	// Same invariant at provision time: without it, `ensureR2Setup` sees no
	// credentials in env and rotates the org-wide R2 token on every run.
	it('provisions no infra storage for a cloudflare-workers project declaring [services.r2]', async () => {
		await expect(
			ensureInfraStorageForConfig(WORKERS_APP_WITH_R2, 'cf-token'),
		).resolves.toBeNull()
		expect(mockEnsureR2Setup).not.toHaveBeenCalled()
	})

	it('still loads the infra storage for a hetzner project', async () => {
		await expect(
			loadInfraStorageForConfig(APP_WITH_DOMAIN),
		).resolves.toEqual(RUNTIME)
		expect(mockLoadR2Runtime).toHaveBeenCalledWith('cf-token')
	})
})
