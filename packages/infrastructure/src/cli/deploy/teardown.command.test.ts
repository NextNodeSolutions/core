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

import type { DeployableConfig } from '#/config/types.ts'

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

// Mock wipePostgresBackups adapter (network boundary: R2 ListObjectsV2 +
// DeleteObjects + DeleteBucket). Hoisted so vi.mock can reach it.
const { mockWipePostgresBackups } = vi.hoisted(() => ({
	mockWipePostgresBackups: vi.fn(),
}))
vi.mock(import('#/adapters/r2/backup-store.ts'), () => ({
	wipePostgresBackups: mockWipePostgresBackups,
}))

// Mock the R2 custom-domain adapter (network boundary: Cloudflare API).
const { mockDeleteR2CustomDomain } = vi.hoisted(() => ({
	mockDeleteR2CustomDomain: vi.fn(),
}))
vi.mock('#/adapters/cloudflare/r2/domains.ts', () => ({
	deleteR2CustomDomain: mockDeleteR2CustomDomain,
}))

// Mock createLogger so we can assert on the preserve/wipe info lines
// emitted by the postgres teardown branch. Existing tests don't assert on
// logs - this mock keeps them green while letting the new tests verify
// which branch ran.
const { mockLoggerInfo } = vi.hoisted(() => ({
	mockLoggerInfo: vi.fn(),
}))
vi.mock('@nextnode-solutions/logger', () => ({
	createLogger: () => ({
		info: mockLoggerInfo,
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn(),
		dispose: vi.fn(),
	}),
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
			false,
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
			false,
		)
	})

	it('passes shouldWipeVolumes=true to the Hetzner target when TEARDOWN_WITH_VOLUMES is set', async () => {
		vi.stubEnv('TEARDOWN_WITH_VOLUMES', '1')
		mockHetznerTeardown.mockResolvedValue({
			kind: 'vps',
			scope: 'project',
			outcome: {
				container: {
					handled: true,
					detail: 'stack, bind mount, and volumes removed',
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

		await teardownCommand(APP_WITH_DOMAIN)

		expect(mockHetznerTeardown).toHaveBeenCalledWith(
			'my-app',
			'example.com',
			'project',
			true,
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
			false,
		)
	})
})

describe('teardownCommand - postgres backup wipe', () => {
	let testPrivateKey: string

	const APP_WITH_POSTGRES: DeployableConfig = {
		...APP_WITH_DOMAIN,
		services: {
			postgres: {
				mode: 'embedded',
			},
		},
	}

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

		mockHetznerTeardown.mockResolvedValue({
			kind: 'vps',
			scope: 'project',
			outcome: {
				container: { handled: true, detail: 'stack removed' },
				caddy: { handled: true, detail: 'route removed' },
				certs: { handled: false, detail: '0 cert object(s) deleted' },
				dns: { handled: true, detail: '1 record(s) deleted' },
				state: { handled: true, detail: 'deleted' },
			},
			durationMs: 1234,
		})
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
		mockHetznerTeardown.mockReset()
		mockWipePostgresBackups.mockReset()
		mockLoggerInfo.mockClear()
	})

	it('preserves the backup bucket when TEARDOWN_WIPE_BACKUPS is unset', async () => {
		await teardownCommand(APP_WITH_POSTGRES)

		expect(mockWipePostgresBackups).not.toHaveBeenCalled()
		expect(mockLoggerInfo).toHaveBeenCalledWith(
			'Preserving backup bucket "nn-backups-my-app" (use --wipe-backups to remove).',
		)
	})

	it('wipes the backup bucket exactly once when TEARDOWN_WIPE_BACKUPS is set', async () => {
		vi.stubEnv('TEARDOWN_WIPE_BACKUPS', '1')

		await teardownCommand(APP_WITH_POSTGRES)

		expect(mockWipePostgresBackups).toHaveBeenCalledTimes(1)
		const [, bucketArg] = mockWipePostgresBackups.mock.calls[0] ?? []
		expect(bucketArg).toBe('nn-backups-my-app')
		expect(mockLoggerInfo).toHaveBeenCalledWith(
			'Wiping backup bucket "nn-backups-my-app" (irreversible)...',
		)
	})
})

describe('teardownCommand - R2 custom domains', () => {
	let testPrivateKey: string

	const APP_WITH_R2_CDN: DeployableConfig = {
		...APP_WITH_DOMAIN,
		services: {
			r2: {
				buckets: [
					{ name: 'assets', cdn: true },
					{ name: 'private-cache', cdn: false },
				],
			},
		},
	}

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
		mockHetznerTeardown.mockResolvedValue({
			kind: 'vps',
			scope: 'project',
			outcome: {
				container: { handled: true, detail: 'removed' },
				caddy: { handled: true, detail: 'removed' },
				certs: { handled: false, detail: '0 cert object(s) deleted' },
				dns: { handled: true, detail: '1 record(s) deleted' },
				state: { handled: true, detail: 'deleted' },
			},
			durationMs: 1,
		})
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
		mockHetznerTeardown.mockReset()
		mockDeleteR2CustomDomain.mockReset()
	})

	it('detaches the custom domain for each cdn-enabled bucket on project teardown', async () => {
		await teardownCommand(APP_WITH_R2_CDN)

		expect(mockDeleteR2CustomDomain).toHaveBeenCalledTimes(1)
		expect(mockDeleteR2CustomDomain).toHaveBeenCalledWith(
			'cf-token',
			'acct',
			'my-app-production-assets',
			'assets.cdn.example.com',
		)
	})

	it('detaches the single-dev-prefixed domain on a development teardown (matches provision)', async () => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')

		await teardownCommand(APP_WITH_R2_CDN)

		expect(mockDeleteR2CustomDomain).toHaveBeenCalledTimes(1)
		expect(mockDeleteR2CustomDomain).toHaveBeenCalledWith(
			'cf-token',
			'acct',
			'my-app-development-assets',
			'assets.cdn.dev.example.com',
		)
	})

	it('does not detach domains for private (non-cdn) buckets', async () => {
		const APP_PRIVATE_ONLY: DeployableConfig = {
			...APP_WITH_DOMAIN,
			services: {
				r2: { buckets: [{ name: 'private-cache', cdn: false }] },
			},
		}

		await teardownCommand(APP_PRIVATE_ONLY)

		expect(mockDeleteR2CustomDomain).not.toHaveBeenCalled()
	})

	it('does not detach domains on a vps-scope teardown', async () => {
		vi.stubEnv('TEARDOWN_TARGET', 'vps')
		mockHetznerTeardown.mockResolvedValue({
			kind: 'vps',
			scope: 'vps',
			outcome: {
				server: { handled: true, detail: 'deleted #1' },
				firewall: { handled: true, detail: 'deleted' },
				tailscale: { handled: false, detail: '0 device(s) purged' },
				dns: { handled: true, detail: '1 record(s) deleted' },
				state: { handled: true, detail: 'deleted' },
			},
			durationMs: 1,
		})

		await teardownCommand(APP_WITH_R2_CDN)

		expect(mockDeleteR2CustomDomain).not.toHaveBeenCalled()
	})
})
