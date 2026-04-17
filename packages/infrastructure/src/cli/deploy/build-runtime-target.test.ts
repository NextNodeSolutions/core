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

import { APP_WITH_DOMAIN, STATIC_WITH_DOMAIN } from '../fixtures.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'

// Mock loadR2Runtime (network boundary: Cloudflare accounts API + SigV4 verify)
vi.mock(import('../r2/load-runtime.ts'), async () => ({
	loadR2Runtime: vi.fn(async () => ({
		accountId: 'acct',
		endpoint: 'https://r2.example.com',
		accessKeyId: 'r2-key',
		secretAccessKey: 'r2-secret',
		stateBucket: 'nextnode-state',
		certsBucket: 'nextnode-certs',
	})),
}))

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
		vi.stubEnv('GHCR_TOKEN', 'ghs_fake_token')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('loads R2 runtime and builds a Hetzner target for Hetzner configs', async () => {
		const { loadR2Runtime } = await import('../r2/load-runtime.ts')
		const { HetznerVpsTarget } =
			await import('../../adapters/hetzner/target.ts')
		const { CloudflarePagesTarget } =
			await import('../../adapters/cloudflare/target.ts')

		const target = await buildRuntimeTarget(APP_WITH_DOMAIN, 'production')

		expect(loadR2Runtime).toHaveBeenCalledWith('cf-token')
		expect(HetznerVpsTarget).toHaveBeenCalledTimes(1)
		expect(CloudflarePagesTarget).not.toHaveBeenCalled()
		expect(target).toEqual({ name: 'hetzner-vps' })
	})

	it('skips R2 and builds a Cloudflare Pages target for CF configs', async () => {
		const { loadR2Runtime } = await import('../r2/load-runtime.ts')
		const { HetznerVpsTarget } =
			await import('../../adapters/hetzner/target.ts')
		const { CloudflarePagesTarget } =
			await import('../../adapters/cloudflare/target.ts')

		const target = await buildRuntimeTarget(
			STATIC_WITH_DOMAIN,
			'production',
		)

		expect(loadR2Runtime).not.toHaveBeenCalled()
		expect(HetznerVpsTarget).not.toHaveBeenCalled()
		expect(CloudflarePagesTarget).toHaveBeenCalledTimes(1)
		expect(target).toEqual({ name: 'cloudflare-pages' })
	})
})
