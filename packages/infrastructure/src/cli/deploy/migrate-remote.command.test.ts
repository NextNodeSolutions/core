import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
	APP_WITH_POSTGRES_EXTERNAL,
} from '#/cli/fixtures.ts'
import type { MigrateResult, SnapshotResult } from '#/domain/deploy/target.ts'

const MIGRATE_RESULT: MigrateResult = { durationMs: 1234 }
const SNAPSHOT_RESULT: SnapshotResult = { durationMs: 4321 }

import { migrateRemoteCommand } from './migrate-remote.command.ts'

// Hoisted vi.fn()s so the HetznerVpsTarget mock can route every target
// method through assertable spies. Hoisting is required because vi.mock
// runs before module imports — without it, the target factory would
// close over `undefined`.
const { mockPrepareRollout, mockRunMigrate, mockRunPreMigrateSnapshot } =
	vi.hoisted(() => ({
		mockPrepareRollout: vi.fn(),
		mockRunMigrate: vi.fn(),
		mockRunPreMigrateSnapshot: vi.fn(),
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
// API). prepareRollout + runPreMigrateSnapshot + runMigrate are routed
// through the hoisted spies so each test can assert on the args + ordering.
vi.mock('../../adapters/hetzner/target.ts', () => ({
	HetznerVpsTarget: vi.fn(() => ({
		name: 'hetzner-vps',
		contributeEnv: () => ({
			public: { SITE_URL: 'https://example.com' },
			secret: {},
		}),
		prepareRollout: mockPrepareRollout,
		runMigrate: mockRunMigrate,
		runPreMigrateSnapshot: mockRunPreMigrateSnapshot,
		deploy: vi.fn(),
		ensureInfra: vi.fn(),
		reconcileDns: vi.fn(),
	})),
}))

describe('migrateRemoteCommand', () => {
	let testPrivateKey: string
	let summaryFile: string

	beforeAll(() => {
		testPrivateKey = sshUtils.generateKeyPairSync('ed25519').private
	})

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		summaryFile = join(tmpdir(), `gh-summary-${id}.txt`)
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
		vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile)
		vi.stubEnv(
			'ALL_SECRETS',
			JSON.stringify({
				POSTGRES_PASSWORD: 'pg-password',
				DATABASE_URL: 'postgres://user:pw@external-host:5432/db',
			}),
		)

		mockPrepareRollout.mockResolvedValue(undefined)
		mockRunMigrate.mockResolvedValue(MIGRATE_RESULT)
		mockRunPreMigrateSnapshot.mockResolvedValue(SNAPSHOT_RESULT)
	})

	afterEach(() => {
		rmSync(summaryFile, { force: true })
		vi.unstubAllEnvs()
		mockPrepareRollout.mockReset()
		mockRunMigrate.mockReset()
		mockRunPreMigrateSnapshot.mockReset()
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

	it('triggers runPreMigrateSnapshot between prepareRollout and runMigrate in embedded mode', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES)

		expect(mockRunPreMigrateSnapshot).toHaveBeenCalledExactlyOnceWith({
			projectName: 'my-app',
			environment: 'production',
		})

		const [prepareOrder] = mockPrepareRollout.mock.invocationCallOrder
		const [snapshotOrder] =
			mockRunPreMigrateSnapshot.mock.invocationCallOrder
		const [migrateOrder] = mockRunMigrate.mock.invocationCallOrder
		if (
			prepareOrder === undefined ||
			snapshotOrder === undefined ||
			migrateOrder === undefined
		) {
			expect.unreachable('all three spies should have been called once')
		}
		expect(prepareOrder).toBeLessThan(snapshotOrder)
		expect(snapshotOrder).toBeLessThan(migrateOrder)
	})

	it('runs runMigrate with the default migrate command after the snapshot', async () => {
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

	it('passes the configured migrate command when [services.postgres].migrate_command is set', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES_CUSTOM_MIGRATE)

		expect(mockRunMigrate).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				migrateCommand: 'pnpm prisma migrate deploy',
			}),
		)
	})

	it('skips runPreMigrateSnapshot when postgres mode is external', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES_EXTERNAL)

		expect(mockPrepareRollout).toHaveBeenCalledOnce()
		expect(mockRunPreMigrateSnapshot).not.toHaveBeenCalled()
		expect(mockRunMigrate).toHaveBeenCalledOnce()
	})

	it('is a no-op when [services.postgres] is absent', async () => {
		await migrateRemoteCommand(APP_WITH_DOMAIN)

		expect(mockPrepareRollout).not.toHaveBeenCalled()
		expect(mockRunPreMigrateSnapshot).not.toHaveBeenCalled()
		expect(mockRunMigrate).not.toHaveBeenCalled()
	})

	it('does NOT call runMigrate when prepareRollout fails', async () => {
		mockPrepareRollout.mockRejectedValueOnce(
			new Error('postgres container unhealthy'),
		)

		await expect(migrateRemoteCommand(APP_WITH_POSTGRES)).rejects.toThrow(
			'postgres container unhealthy',
		)
		expect(mockRunPreMigrateSnapshot).not.toHaveBeenCalled()
		expect(mockRunMigrate).not.toHaveBeenCalled()
	})

	it('does NOT call runMigrate when runPreMigrateSnapshot fails', async () => {
		mockRunPreMigrateSnapshot.mockRejectedValueOnce(
			new Error('backup sidecar exited with code 1'),
		)

		await expect(migrateRemoteCommand(APP_WITH_POSTGRES)).rejects.toThrow(
			'backup sidecar exited with code 1',
		)
		expect(mockPrepareRollout).toHaveBeenCalledOnce()
		expect(mockRunMigrate).not.toHaveBeenCalled()
	})

	it('writes a step summary with the snapshot duration after a successful migrate', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES)

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain('## Migrate')
		expect(summary).toContain('| **Project** | my-app |')
		expect(summary).toContain('| **Environment** | production |')
		expect(summary).toContain('| **Pre-migrate snapshot** | 4.3s |')
		expect(summary).toContain('| **Migrate duration** | 1.2s |')
	})

	it('omits the snapshot row from the summary when postgres mode is external', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES_EXTERNAL)

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain('## Migrate')
		expect(summary).not.toContain('Pre-migrate snapshot')
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

		expect(mockRunPreMigrateSnapshot).toHaveBeenCalledExactlyOnceWith({
			projectName: 'my-app',
			environment: 'development',
		})
		expect(mockRunMigrate).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ environment: 'development' }),
		)
	})
})
