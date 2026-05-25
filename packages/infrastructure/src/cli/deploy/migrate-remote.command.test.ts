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

import {
	APP_WITH_DOMAIN,
	APP_WITH_POSTGRES,
	APP_WITH_POSTGRES_CUSTOM_MIGRATE,
} from '#/cli/fixtures.ts'
import type { MigrateResult } from '#/domain/deploy/target.ts'

import { migrateRemoteCommand } from './migrate-remote.command.ts'

// Hoisted vi.fn()s so the HetznerVpsTarget mock can route both target
// methods through assertable spies. Hoisting is required because vi.mock
// runs before module imports — without it, the target factory would
// close over `undefined`.
const { mockPrepareRollout, mockRunMigrate } = vi.hoisted(() => ({
	mockPrepareRollout: vi.fn(),
	mockRunMigrate: vi.fn(),
}))

// Mock loadR2Runtime (network boundary: Cloudflare accounts API + SigV4
// verify). migrate-remote must NOT depend on R2 bootstrap — that lives
// in provision.
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

// Mock HetznerVpsTarget (network boundary: SSH, R2 state, Hetzner Cloud
// API). prepareRollout + runMigrate are routed through the hoisted spies
// so each test can assert on the args + ordering.
vi.mock('../../adapters/hetzner/target.ts', () => ({
	HetznerVpsTarget: vi.fn(() => ({
		name: 'hetzner-vps',
		contributeEnv: () => ({
			public: { SITE_URL: 'https://example.com' },
			secret: {},
		}),
		prepareRollout: mockPrepareRollout,
		runMigrate: mockRunMigrate,
		deploy: vi.fn(),
		ensureInfra: vi.fn(),
		reconcileDns: vi.fn(),
	})),
}))

const MIGRATE_RESULT: MigrateResult = { durationMs: 1234 }

describe('migrateRemoteCommand', () => {
	let testPrivateKey: string

	beforeAll(() => {
		testPrivateKey = sshUtils.generateKeyPairSync('ed25519').private
	})

	beforeEach(() => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('HETZNER_API_TOKEN', 'hcloud-token')
		vi.stubEnv(
			'DEPLOY_SSH_PRIVATE_KEY_B64',
			Buffer.from(testPrivateKey).toString('base64'),
		)
		vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey-auth-test')
		vi.stubEnv('GHCR_TOKEN', 'ghs_fake_token')
		vi.stubEnv('IMAGE_REF', 'ghcr.io/acme/web:sha-abc123')
		vi.stubEnv('LOG_LEVEL', 'silent')
		vi.stubEnv(
			'ALL_SECRETS',
			JSON.stringify({ POSTGRES_PASSWORD: 'pg-password' }),
		)

		mockPrepareRollout.mockResolvedValue(undefined)
		mockRunMigrate.mockResolvedValue(MIGRATE_RESULT)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('runs prepareRollout with the resolved env+input when postgres is configured', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES)

		expect(mockPrepareRollout).toHaveBeenCalledExactlyOnceWith(
			'my-app',
			{
				secrets: {
					POSTGRES_PASSWORD: 'pg-password',
					DATABASE_URL:
						'postgres://my_app:pg-password@postgres:5432/my_app',
				},
				image: {
					registry: 'ghcr.io',
					repository: 'acme/web',
					tag: 'sha-abc123',
				},
				registryToken: 'ghs_fake_token',
			},
			{
				SITE_URL: 'https://example.com',
				POSTGRES_USER: 'my_app',
				POSTGRES_DB: 'my_app',
			},
		)
	})

	it('runs runMigrate with the default migrate command after prepareRollout', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES)

		expect(mockRunMigrate).toHaveBeenCalledExactlyOnceWith({
			projectName: 'my-app',
			environment: 'production',
			image: {
				registry: 'ghcr.io',
				repository: 'acme/web',
				tag: 'sha-abc123',
			},
			migrateCommand: 'node scripts/migrate.js',
		})
	})

	it('calls prepareRollout BEFORE runMigrate', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES)

		const [prepareOrder] = mockPrepareRollout.mock.invocationCallOrder
		const [migrateOrder] = mockRunMigrate.mock.invocationCallOrder
		if (prepareOrder === undefined || migrateOrder === undefined) {
			expect.unreachable('both spies should have been called once')
		}
		expect(prepareOrder).toBeLessThan(migrateOrder)
	})

	it('passes the configured migrate command when [services.postgres].migrate_command is set', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES_CUSTOM_MIGRATE)

		expect(mockRunMigrate).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				migrateCommand: 'pnpm prisma migrate deploy',
			}),
		)
	})

	it('is a no-op when [services.postgres] is absent', async () => {
		await migrateRemoteCommand(APP_WITH_DOMAIN)

		expect(mockPrepareRollout).not.toHaveBeenCalled()
		expect(mockRunMigrate).not.toHaveBeenCalled()
	})

	it('does NOT call runMigrate when prepareRollout fails', async () => {
		mockPrepareRollout.mockRejectedValueOnce(
			new Error('postgres container unhealthy'),
		)

		await expect(migrateRemoteCommand(APP_WITH_POSTGRES)).rejects.toThrow(
			'postgres container unhealthy',
		)
		expect(mockRunMigrate).not.toHaveBeenCalled()
	})

	it('throws when IMAGE_REF is missing', async () => {
		vi.stubEnv('IMAGE_REF', '')

		await expect(migrateRemoteCommand(APP_WITH_POSTGRES)).rejects.toThrow(
			'IMAGE_REF env var is required',
		)
		expect(mockPrepareRollout).not.toHaveBeenCalled()
	})

	it('throws when IMAGE_REF is malformed', async () => {
		vi.stubEnv('IMAGE_REF', 'no-tag-here')

		await expect(migrateRemoteCommand(APP_WITH_POSTGRES)).rejects.toThrow(
			/Invalid image ref/,
		)
		expect(mockPrepareRollout).not.toHaveBeenCalled()
	})

	it('targets the development environment when PIPELINE_ENVIRONMENT is development', async () => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')

		await migrateRemoteCommand(APP_WITH_POSTGRES)

		expect(mockRunMigrate).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ environment: 'development' }),
		)
	})
})
