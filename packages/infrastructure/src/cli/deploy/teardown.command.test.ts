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

import { APP_WITH_DOMAIN, STATIC_WITH_DOMAIN } from '#/cli/fixtures.ts'

import { teardownCommand } from './teardown.command.ts'

// Mock loadR2Runtime (network boundary: Cloudflare accounts API + SigV4 verify)
vi.mock(import('#/cli/r2/load-runtime.ts'), async () => ({
	loadR2Runtime: vi.fn(async () => ({
		accountId: 'acct',
		endpoint: 'https://r2.example.com',
		accessKeyId: 'r2-key',
		secretAccessKey: 'r2-secret',
		stateBucket: 'nextnode-state',
		certsBucket: 'nextnode-certs',
	})),
}))

// Mock HetznerVpsTarget class (network boundary: SSH, R2, Hetzner Cloud API)
const { mockHetznerTeardown } = vi.hoisted(() => ({
	mockHetznerTeardown: vi.fn(),
}))
vi.mock('../../adapters/hetzner/target.ts', () => ({
	HetznerVpsTarget: vi.fn(() => ({
		name: 'hetzner-vps',
		teardown: mockHetznerTeardown,
		ensureInfra: vi.fn(),
		contributeEnv: vi.fn(),
		deploy: vi.fn(),
		reconcileDns: vi.fn(),
	})),
}))

// Mock CloudflarePagesTarget class (network boundary: Cloudflare API)
const { mockPagesTeardown } = vi.hoisted(() => ({
	mockPagesTeardown: vi.fn(),
}))
vi.mock('../../adapters/cloudflare/target.ts', () => ({
	CloudflarePagesTarget: vi.fn(() => ({
		name: 'cloudflare-pages',
		teardown: mockPagesTeardown,
		ensureInfra: vi.fn(),
		contributeEnv: vi.fn(),
		deploy: vi.fn(),
		reconcileDns: vi.fn(),
	})),
}))

function tmpSummaryFile(): string {
	const path = `${process.env['TMPDIR'] ?? '/tmp'}/teardown-summary-${String(Date.now())}.md`
	return path
}

describe('teardownCommand - hetzner dispatch', () => {
	let testPrivateKey: string

	beforeAll(() => {
		testPrivateKey = sshUtils.generateKeyPairSync('ed25519').private
	})

	beforeEach(() => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('HETZNER_API_TOKEN', 'hcloud-token')
		vi.stubEnv(
			'DEPLOY_SSH_PRIVATE_KEY_B64',
			Buffer.from(testPrivateKey).toString('base64'),
		)
		vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey-auth-test')
		vi.stubEnv('GITHUB_STEP_SUMMARY', tmpSummaryFile())
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
		mockHetznerTeardown.mockReset()
	})

	it('dispatches to the Hetzner target with correct arguments', async () => {
		mockHetznerTeardown.mockResolvedValue({
			kind: 'vps',
			scope: 'project',
			outcome: {
				container: {
					handled: true,
					detail: 'stack and bind mount removed',
				},
				caddy: {
					handled: true,
					detail: 'route removed, Caddy reloaded',
				},
				certs: { handled: false, detail: '0 cert object(s) deleted' },
				dns: { handled: true, detail: '1 record(s) deleted' },
				state: { handled: true, detail: 'deleted' },
			},
			durationMs: 1234,
		})
		const { loadR2Runtime } = await import('#/cli/r2/load-runtime.ts')
		const { HetznerVpsTarget } =
			await import('#/adapters/hetzner/target.ts')

		await teardownCommand(APP_WITH_DOMAIN)

		expect(loadR2Runtime).toHaveBeenCalledWith('cf-token')
		expect(HetznerVpsTarget).toHaveBeenCalled()
		expect(mockHetznerTeardown).toHaveBeenCalledWith(
			'my-app',
			'example.com',
			'project',
		)
	})

	it('passes TEARDOWN_TARGET=vps to the Hetzner target when set', async () => {
		vi.stubEnv('TEARDOWN_TARGET', 'vps')
		mockHetznerTeardown.mockResolvedValue({
			kind: 'vps',
			scope: 'vps',
			outcome: {
				server: { handled: true, detail: 'deleted #42' },
				firewall: { handled: true, detail: 'deleted' },
				tailscale: { handled: false, detail: '0 device(s) purged' },
				dns: { handled: true, detail: '1 record(s) deleted' },
				state: { handled: true, detail: 'deleted' },
			},
			durationMs: 1234,
		})

		await teardownCommand(APP_WITH_DOMAIN)

		expect(mockHetznerTeardown).toHaveBeenCalledWith(
			'my-app',
			'example.com',
			'vps',
		)
	})

	it('fails loud on an unknown TEARDOWN_TARGET value', async () => {
		vi.stubEnv('TEARDOWN_TARGET', 'full')

		await expect(teardownCommand(APP_WITH_DOMAIN)).rejects.toThrow(
			/Invalid TEARDOWN_TARGET "full"/,
		)
	})
})

describe('teardownCommand - cloudflare pages dispatch', () => {
	beforeEach(() => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('GITHUB_STEP_SUMMARY', tmpSummaryFile())
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
		mockPagesTeardown.mockReset()
	})

	it('dispatches to the Cloudflare Pages target', async () => {
		mockPagesTeardown.mockResolvedValue({
			kind: 'static',
			scope: 'project',
			pagesProjectName: 'my-site-prod',
			outcome: {
				'pages-project': { handled: true, detail: 'deleted' },
				dns: { handled: true, detail: '1 record(s) deleted' },
			},
			durationMs: 800,
		})

		await teardownCommand(STATIC_WITH_DOMAIN)

		expect(mockPagesTeardown).toHaveBeenCalledWith(
			'my-site',
			'example.com',
			'project',
		)
	})
})
