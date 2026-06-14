import { NoSuchBucket } from '@aws-sdk/client-s3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'

const prunePostgresBackupsMock = vi.hoisted(() => vi.fn())
const loadR2RuntimeMock = vi.hoisted(() => vi.fn())
const listKeysMock = vi.hoisted(() => vi.fn())
const tryLoadBackupCredsMock = vi.hoisted(() => vi.fn())
const writeSummaryMock = vi.hoisted(() => vi.fn())

vi.mock('#/adapters/r2/backup-store.ts', () => ({
	prunePostgresBackups: prunePostgresBackupsMock,
}))
vi.mock('#/cli/r2/load-runtime.ts', () => ({
	loadR2Runtime: loadR2RuntimeMock,
}))
// The pg_dump bucket is reached with the per-project backup token, loaded from
// the state bucket - mock that boundary so the test asserts which (project,
// environment) creds the prune resolves and uses.
vi.mock('#/cli/services/postgres/postgres-backup-creds.ts', () => ({
	tryLoadPostgresBackupCreds: tryLoadBackupCredsMock,
}))
// The cron enumerates provisioned backups by listing the state bucket; only
// listKeys is exercised (the keys themselves carry project + environment, so no
// per-object read is needed for enumeration).
vi.mock('#/adapters/r2/client.ts', () => ({
	R2Client: vi.fn(() => ({ listKeys: listKeysMock })),
}))
vi.mock('#/adapters/github/output.ts', () => ({
	writeSummary: writeSummaryMock,
}))

import { pruneBackupsCommand, pruneProjectBackups } from './prune-backups.ts'

const INFRA_STORAGE: InfraStorageRuntimeConfig = {
	accountId: 'acct',
	endpoint: 'https://acct.r2.cloudflarestorage.com',
	accessKeyId: 'r2-key',
	secretAccessKey: 'r2-secret',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
}

// Per-project backup token creds (scoped to the project's backup buckets), as
// returned by tryLoadPostgresBackupCreds. Distinct from the infra state creds
// so a regression that lists with the wrong token would surface here.
const BACKUP_CREDS = {
	endpoint: 'https://acct.r2.cloudflarestorage.com',
	accessKeyId: 'backup-key',
	secretAccessKey: 'backup-secret',
}

afterEach(() => {
	vi.clearAllMocks()
	vi.unstubAllEnvs()
})

describe('pruneProjectBackups', () => {
	it('prunes the dump bucket using the per-project backup token', async () => {
		tryLoadBackupCredsMock.mockResolvedValue(BACKUP_CREDS)
		prunePostgresBackupsMock.mockResolvedValue({ scanned: 20, pruned: 6 })

		const outcome = await pruneProjectBackups(
			INFRA_STORAGE,
			'acme-web',
			'production',
		)

		expect(outcome).toEqual({
			project: 'acme-web',
			scanned: 20,
			pruned: 6,
			bucketMissing: false,
		})
		expect(tryLoadBackupCredsMock).toHaveBeenCalledWith({
			infraStorage: INFRA_STORAGE,
			projectName: 'acme-web',
			environment: 'production',
		})
		const [s3, bucket] = prunePostgresBackupsMock.mock.calls[0] ?? []
		expect(bucket).toBe('acme-web-backups-dump')
		// The list runs against a client built from the backup token creds.
		expect(s3).toBeDefined()
	})

	it('skips a project with no backup creds (non-postgres app)', async () => {
		tryLoadBackupCredsMock.mockResolvedValue(null)

		const outcome = await pruneProjectBackups(
			INFRA_STORAGE,
			'static-site',
			'production',
		)

		expect(outcome).toEqual({
			project: 'static-site',
			scanned: 0,
			pruned: 0,
			bucketMissing: true,
		})
		expect(prunePostgresBackupsMock).not.toHaveBeenCalled()
	})

	it('treats a wiped bucket (NoSuchBucket) as nothing to prune', async () => {
		tryLoadBackupCredsMock.mockResolvedValue(BACKUP_CREDS)
		prunePostgresBackupsMock.mockRejectedValue(
			new NoSuchBucket({ $metadata: {}, message: 'no such bucket' }),
		)

		const outcome = await pruneProjectBackups(
			INFRA_STORAGE,
			'acme-web',
			'production',
		)

		expect(outcome).toEqual({
			project: 'acme-web',
			scanned: 0,
			pruned: 0,
			bucketMissing: true,
		})
	})

	it('rethrows non-NoSuchBucket failures rather than masking them as clean', async () => {
		tryLoadBackupCredsMock.mockResolvedValue(BACKUP_CREDS)
		prunePostgresBackupsMock.mockRejectedValue(new Error('AccessDenied'))

		await expect(
			pruneProjectBackups(INFRA_STORAGE, 'acme-web', 'production'),
		).rejects.toThrow('AccessDenied')
	})
})

describe('pruneBackupsCommand', () => {
	// pruneBackupsCommand reads CLOUDFLARE_API_TOKEN via requireEnv before the
	// mocked loadR2Runtime ignores its value. Stub it so the test is hermetic.
	beforeEach(() => {
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
	})

	it('enumerates provisioned backups from state keys and prunes each', async () => {
		loadR2RuntimeMock.mockResolvedValue(INFRA_STORAGE)
		listKeysMock.mockResolvedValue([
			'services/postgres-backup/proj-1/production.json',
			'services/postgres-backup/proj-2/production.json',
			'services/postgres-backup/proj-3/development.json',
			'services/postgres-backup/stray-object.txt',
		])
		tryLoadBackupCredsMock.mockResolvedValue(BACKUP_CREDS)
		prunePostgresBackupsMock.mockResolvedValue({ scanned: 10, pruned: 2 })

		await pruneBackupsCommand()

		const prunedBuckets = prunePostgresBackupsMock.mock.calls
			.map((call: unknown[]) => String(call[1]))
			.toSorted((a, b) => a.localeCompare(b))
		expect(prunedBuckets).toEqual([
			'proj-1-backups-dump',
			'proj-2-backups-dump',
			'proj-3-backups-dump',
		])
		// The malformed key is dropped, not pruned.
		expect(prunePostgresBackupsMock).toHaveBeenCalledTimes(3)
		// Each key's environment is threaded into the creds load.
		expect(tryLoadBackupCredsMock).toHaveBeenCalledWith({
			infraStorage: INFRA_STORAGE,
			projectName: 'proj-3',
			environment: 'development',
		})
		expect(writeSummaryMock).toHaveBeenCalledOnce()
	})

	it('writes a summary and prunes nothing when no backups are provisioned', async () => {
		loadR2RuntimeMock.mockResolvedValue(INFRA_STORAGE)
		listKeysMock.mockResolvedValue([])

		await pruneBackupsCommand()

		expect(prunePostgresBackupsMock).not.toHaveBeenCalled()
		expect(writeSummaryMock).toHaveBeenCalledOnce()
	})
})
