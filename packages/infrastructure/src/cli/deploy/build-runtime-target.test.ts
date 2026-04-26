import ssh2 from 'ssh2'
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest'

const { utils: sshUtils } = ssh2

import { APP_WITH_DOMAIN, STATIC_WITH_DOMAIN } from '@/cli/fixtures.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'

const FAKE_INFRA_R2 = {
	accountId: 'acct',
	endpoint: 'https://r2.example.com',
	accessKeyId: 'r2-key',
	secretAccessKey: 'r2-secret',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
}

// Mock target classes so we can assert which one got instantiated
vi.mock('../../adapters/hetzner/target.ts', () => ({
	HetznerVpsTarget: vi.fn(() => ({ name: 'hetzner-vps' })),
}))
vi.mock('../../adapters/cloudflare/target.ts', () => ({
	CloudflarePagesTarget: vi.fn(() => ({ name: 'cloudflare-pages' })),
}))

describe('buildRuntimeTarget', () => {
	let testPrivateKey: string

	beforeAll(() => {
		testPrivateKey = sshUtils.generateKeyPairSync('ed25519').private
	})

	beforeEach(() => {
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('HETZNER_API_TOKEN', 'hcloud-token')
		vi.stubEnv(
			'DEPLOY_SSH_PRIVATE_KEY_B64',
			Buffer.from(testPrivateKey).toString('base64'),
		)
		vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey-auth-test')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('builds a Hetzner target with the threaded R2 runtime', async () => {
		const { HetznerVpsTarget } =
			await import('@/adapters/hetzner/target.ts')
		const { CloudflarePagesTarget } =
			await import('@/adapters/cloudflare/target.ts')

		const target = buildRuntimeTarget(
			APP_WITH_DOMAIN,
			'production',
			FAKE_INFRA_R2,
		)

		expect(HetznerVpsTarget).toHaveBeenCalledTimes(1)
		expect(CloudflarePagesTarget).not.toHaveBeenCalled()
		expect(target).toEqual({ name: 'hetzner-vps' })
	})

	it('throws when Hetzner is requested without an infra R2 runtime', () => {
		expect(() =>
			buildRuntimeTarget(APP_WITH_DOMAIN, 'production', null),
		).toThrow('Hetzner target requires infra R2')
	})

	it('builds a Cloudflare Pages target without needing infra R2', async () => {
		const { HetznerVpsTarget } =
			await import('@/adapters/hetzner/target.ts')
		const { CloudflarePagesTarget } =
			await import('@/adapters/cloudflare/target.ts')

		const target = buildRuntimeTarget(
			STATIC_WITH_DOMAIN,
			'production',
			null,
		)

		expect(HetznerVpsTarget).not.toHaveBeenCalled()
		expect(CloudflarePagesTarget).toHaveBeenCalledTimes(1)
		expect(target).toEqual({ name: 'cloudflare-pages' })
	})
})
