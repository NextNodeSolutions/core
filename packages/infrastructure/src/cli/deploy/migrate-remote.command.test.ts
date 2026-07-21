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
	WORKERS_APP_WITH_DOMAIN,
} from '#/cli/fixtures.ts'

import type {
	CloudflareWorkersDeployableConfig,
	DeployableConfig,
} from '#/config/types.ts'
import type { MigrateResult } from '#/domain/deploy/target.ts'

const MIGRATE_RESULT: MigrateResult = { durationMs: 1234 }

// front + api both build; only api owns the schema (needs = ["postgres"]). The
// migrate image must be api's, never front's.
const APP_MULTI_SERVICE_POSTGRES: DeployableConfig = {
	...APP_WITH_POSTGRES,
	project: { ...APP_WITH_POSTGRES.project, domain: 'example.com' },
	deploy: {
		target: 'hetzner-vps',
		cron: [],
		hetzner: { serverType: 'cx23', location: 'nbg1' },
		secrets: [],
		generatedSecrets: [],
		vps: null,
		volumes: [],
		services: {
			front: {
				port: 3000,
				url: 'example.com',
				secrets: [],
				needs: [],
				dependsOn: [],
				source: 'build',
				target: 'front',
			},
			api: {
				port: 4000,
				url: 'api.example.com',
				secrets: [],
				needs: ['postgres'],
				dependsOn: [],
				source: 'build',
				target: 'api',
			},
		},
	},
}

import { migrateRemoteCommand } from './migrate-remote.command.ts'

// Hoisted vi.fn()s so the HetznerVpsTarget mock can route every target method
// through assertable spies. With wal-g, the pre-migrate auto-restore + snapshot
// are gone (restore happens in the postgres image entrypoint; continuity is
// continuous WAL archiving), so the command is just prepareRollout -> migrate.
const { mockPrepareRollout, mockRunMigrate, mockPruneProjectBackups } =
	vi.hoisted(() => ({
		mockPrepareRollout: vi.fn(),
		mockRunMigrate: vi.fn(),
		mockPruneProjectBackups: vi.fn(),
	}))

// Mock the on-deploy GFS prune (network boundary: R2 list+delete). The prune
// itself is covered in prune-backups + backup-store tests; here we only assert
// migrate-remote invokes it after a successful migrate, never before.
vi.mock('./prune-backups.ts', () => ({
	pruneProjectBackups: mockPruneProjectBackups,
	pruneBackupsCommand: vi.fn(),
}))

// Mock loadR2Runtime (network boundary: Cloudflare accounts API + SigV4
// verify). migrate-remote must NOT depend on R2 bootstrap - that lives in
// provision.
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

// Mock the postgres backup R2 credentials load (network boundary: reads the
// dedicated, infra-owned backup token from the state bucket). Provision writes
// it; migrate-remote only reads it back to project POSTGRES_BACKUP_R2_* into
// the shared `.env` the backup sidecar interpolates.
vi.mock('#/cli/services/postgres/postgres-backup-creds.ts', () => ({
	loadPostgresBackupCreds: vi.fn(async () => ({
		endpoint: 'https://r2.example.com',
		accessKeyId: 'bk-key',
		secretAccessKey: 'bk-secret',
	})),
	provisionPostgresBackupCreds: vi.fn(),
}))

// Mock HetznerVpsTarget (network boundary: SSH, R2 state, Hetzner Cloud API).
// prepareRollout + runMigrate are routed through the hoisted spies so each test
// can assert on the args + ordering.
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

// Mock CloudflareWorkersTarget (network boundary: terraform + wrangler). Only
// runMigrate is exercised here; contributeEnv is enough for resolveDeployContext
// to build the merged env (no loadBackingEnv, so no terraform output read).
const { mockRunMigrateWorkers, mockPrepareRolloutWorkers } = vi.hoisted(() => ({
	mockRunMigrateWorkers: vi.fn(),
	mockPrepareRolloutWorkers: vi.fn(),
}))

vi.mock('../../adapters/cloudflare/workers/target.ts', () => ({
	CloudflareWorkersTarget: vi.fn(() => ({
		name: 'cloudflare-workers',
		contributeEnv: () => ({
			public: { SITE_URL: 'https://example.com' },
			secret: {},
		}),
		runMigrate: mockRunMigrateWorkers,
		prepareRollout: mockPrepareRolloutWorkers,
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
		vi.stubEnv('GITHUB_REPOSITORY', 'NextNodeSolutions/core')
		vi.stubEnv('HETZNER_API_TOKEN', 'hcloud-token')
		vi.stubEnv(
			'DEPLOY_SSH_PRIVATE_KEY_B64',
			Buffer.from(testPrivateKey).toString('base64'),
		)
		vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey-auth-test')
		vi.stubEnv('GHCR_TOKEN', 'ghs_fake_token')
		vi.stubEnv(
			'IMAGE_REFS',
			JSON.stringify({
				app: {
					registry: 'ghcr.io',
					repository: 'acme/web',
					tag: 'sha-abc123',
				},
			}),
		)
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
		mockPruneProjectBackups.mockResolvedValue({
			project: 'my-app',
			scanned: 0,
			pruned: 0,
			bucketMissing: false,
		})
	})

	afterEach(() => {
		rmSync(summaryFile, { force: true })
		vi.unstubAllEnvs()
		mockPrepareRollout.mockReset()
		mockRunMigrate.mockReset()
		mockPruneProjectBackups.mockReset()
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
					POSTGRES_BACKUP_R2_ACCESS_KEY_ID: 'bk-key',
					POSTGRES_BACKUP_R2_SECRET_ACCESS_KEY: 'bk-secret',
					POSTGRES_BACKUP_R2_ENDPOINT: 'https://r2.example.com',
				},
				secretOrigins: {
					POSTGRES_PASSWORD: 'postgres',
					DATABASE_URL: 'postgres',
					POSTGRES_BACKUP_R2_ACCESS_KEY_ID: 'postgres',
					POSTGRES_BACKUP_R2_SECRET_ACCESS_KEY: 'postgres',
					POSTGRES_BACKUP_R2_ENDPOINT: 'postgres',
				},
				images: {
					app: {
						registry: 'ghcr.io',
						repository: 'acme/web',
						tag: 'sha-abc123',
					},
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

	it('orders prepareRollout before migrate', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES)

		const [prepareOrder] = mockPrepareRollout.mock.invocationCallOrder
		const [migrateOrder] = mockRunMigrate.mock.invocationCallOrder
		if (prepareOrder === undefined || migrateOrder === undefined) {
			expect.unreachable('both spies should have been called once')
		}
		expect(prepareOrder).toBeLessThan(migrateOrder)
	})

	it('runs runMigrate with the default migrate command', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES)

		expect(mockRunMigrate).toHaveBeenCalledExactlyOnceWith({
			kind: 'container',
			projectName: 'my-app',
			environment: 'production',
			image: {
				registry: 'ghcr.io',
				repository: 'acme/web',
				tag: 'sha-abc123',
			},
			migrateCommand: 'pnpm drizzle-kit migrate',
		})
	})

	it('runs the migration with the schema-owning service image in a multi-service deploy', async () => {
		vi.stubEnv(
			'IMAGE_REFS',
			JSON.stringify({
				front: {
					registry: 'ghcr.io',
					repository: 'acme/web-front',
					tag: 'sha-front0',
				},
				api: {
					registry: 'ghcr.io',
					repository: 'acme/web-api',
					tag: 'sha-api00',
				},
			}),
		)

		await migrateRemoteCommand(APP_MULTI_SERVICE_POSTGRES)

		expect(mockRunMigrate).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				image: {
					registry: 'ghcr.io',
					repository: 'acme/web-api',
					tag: 'sha-api00',
				},
			}),
		)
	})

	it('passes the configured migrate command when [services.postgres].migrate_command is set', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES_CUSTOM_MIGRATE)

		expect(mockRunMigrate).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				migrateCommand: 'pnpm prisma migrate deploy',
			}),
		)
	})

	it('stages + migrates for external postgres too', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES_EXTERNAL)

		expect(mockPrepareRollout).toHaveBeenCalledOnce()
		expect(mockRunMigrate).toHaveBeenCalledOnce()
	})

	it('prunes the pg_dump bucket AFTER a successful migrate (embedded)', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES)

		expect(mockPruneProjectBackups).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ stateBucket: 'nextnode-state' }),
			'my-app',
			'production',
		)
		const [migrateOrder] = mockRunMigrate.mock.invocationCallOrder
		const [pruneOrder] = mockPruneProjectBackups.mock.invocationCallOrder
		if (migrateOrder === undefined || pruneOrder === undefined) {
			expect.unreachable('both spies should have been called once')
		}
		expect(pruneOrder).toBeGreaterThan(migrateOrder)
	})

	it('does NOT prune for external postgres (no NextNode-owned dump bucket)', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES_EXTERNAL)

		expect(mockPruneProjectBackups).not.toHaveBeenCalled()
	})

	it('does NOT prune when prepareRollout fails (migrate never ran)', async () => {
		mockPrepareRollout.mockRejectedValueOnce(new Error('db unhealthy'))

		await expect(migrateRemoteCommand(APP_WITH_POSTGRES)).rejects.toThrow(
			'db unhealthy',
		)
		expect(mockPruneProjectBackups).not.toHaveBeenCalled()
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

	it('writes a step summary after a successful migrate (no pre-migrate snapshot row)', async () => {
		await migrateRemoteCommand(APP_WITH_POSTGRES)

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain('## Migrate')
		expect(summary).toContain('| **Project** | my-app |')
		expect(summary).toContain('| **Environment** | production |')
		expect(summary).toContain('| **Migrate duration** | 1.2s |')
		expect(summary).not.toContain('Pre-migrate snapshot')
	})

	it('throws when IMAGE_REFS is missing', async () => {
		vi.stubEnv('IMAGE_REFS', '')

		await expect(migrateRemoteCommand(APP_WITH_POSTGRES)).rejects.toThrow(
			'IMAGE_REFS env var is required',
		)
		expect(mockPrepareRollout).not.toHaveBeenCalled()
	})

	it('throws when IMAGE_REFS is malformed', async () => {
		vi.stubEnv('IMAGE_REFS', 'no-tag-here')

		await expect(migrateRemoteCommand(APP_WITH_POSTGRES)).rejects.toThrow(
			/Invalid IMAGE_REFS/,
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

const WORKERS_APP_WITH_D1: CloudflareWorkersDeployableConfig = {
	...WORKERS_APP_WITH_DOMAIN,
	project: {
		type: 'app',
		name: 'my-worker',
		domain: 'example.com',
		redirectDomains: [],
		filter: false,
		internal: false,
	},
	services: { d1: { migrationsFolder: 'drizzle' } },
	deploy: {
		target: 'cloudflare-workers',
		generatedSecrets: [],
		secrets: [],
		vps: null,
		volumes: [],
		cron: [],
		services: {
			web: {
				url: 'example.com',
				secrets: [],
				needs: ['d1'],
				dependsOn: [],
				entry: 'dist/_worker.js/index.js',
			},
		},
	},
}

describe('migrateRemoteCommand (cloudflare-workers D1)', () => {
	let summaryFile: string

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		summaryFile = join(tmpdir(), `gh-summary-workers-${id}.txt`)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('TF_TOKEN_app_terraform_io', 'tf-token')
		vi.stubEnv('GITHUB_REPOSITORY', 'NextNodeSolutions/core')
		vi.stubEnv('LOG_LEVEL', 'silent')
		vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile)
		vi.stubEnv('ALL_SECRETS', JSON.stringify({}))
		mockRunMigrateWorkers.mockResolvedValue(MIGRATE_RESULT)
	})

	afterEach(() => {
		rmSync(summaryFile, { force: true })
		vi.unstubAllEnvs()
		mockRunMigrateWorkers.mockReset()
		mockPrepareRolloutWorkers.mockReset()
	})

	it('runs the D1 migrate without staging a rollout when [services.d1] is set', async () => {
		await migrateRemoteCommand(WORKERS_APP_WITH_D1)

		expect(mockRunMigrateWorkers).toHaveBeenCalledExactlyOnceWith({
			kind: 'd1',
			projectName: 'my-worker',
			environment: 'production',
		})
		expect(mockPrepareRolloutWorkers).not.toHaveBeenCalled()
	})

	it('does not require IMAGE_REFS for a D1 migrate', async () => {
		vi.stubEnv('IMAGE_REFS', '')

		await migrateRemoteCommand(WORKERS_APP_WITH_D1)

		expect(mockRunMigrateWorkers).toHaveBeenCalledOnce()
	})

	it('writes a migrate step summary after a successful D1 apply', async () => {
		await migrateRemoteCommand(WORKERS_APP_WITH_D1)

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain('## Migrate')
		expect(summary).toContain('| **Project** | my-worker |')
		expect(summary).toContain('| **Migrate duration** | 1.2s |')
		expect(summary).not.toContain('Pre-migrate snapshot')
	})

	it('is a no-op when the workers project declares no [services.d1]', async () => {
		await migrateRemoteCommand(WORKERS_APP_WITH_DOMAIN)

		expect(mockRunMigrateWorkers).not.toHaveBeenCalled()
	})

	it('targets the development environment when PIPELINE_ENVIRONMENT is development', async () => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')

		await migrateRemoteCommand(WORKERS_APP_WITH_D1)

		expect(mockRunMigrateWorkers).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ environment: 'development' }),
		)
	})
})
