import { NoSuchBucket } from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'

const prunePostgresBackupsMock = vi.hoisted(() => vi.fn())
const loadR2RuntimeMock = vi.hoisted(() => vi.fn())
const listKeysMock = vi.hoisted(() => vi.fn())
const getMock = vi.hoisted(() => vi.fn())
const writeSummaryMock = vi.hoisted(() => vi.fn())

vi.mock('#/adapters/r2/backup-store.ts', () => ({
	prunePostgresBackups: prunePostgresBackupsMock,
}))
vi.mock('#/cli/r2/load-runtime.ts', () => ({
	loadR2Runtime: loadR2RuntimeMock,
}))
// The state R2Client only needs listKeys (enumerate state files) + get (read
// each state object, consumed by the REAL readState parser). The real
// STATE_KEY_PREFIX + vpsNameFromStateKey run unmocked.
vi.mock('#/adapters/r2/client.ts', () => ({
	R2Client: vi.fn(() => ({ listKeys: listKeysMock, get: getMock })),
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

// A valid converged state object body the REAL readState parser accepts.
function stateJson(projects: ReadonlyArray<string>): string {
	const hostPorts: Record<string, Record<string, number>> = {}
	for (const project of projects) hostPorts[project] = { app: 8080 }
	return JSON.stringify({
		phase: 'converged',
		serverId: 1,
		publicIp: '1.2.3.4',
		tailnetIp: '100.1.2.3',
		convergedAt: '2026-01-01T00:00:00Z',
		hostPorts,
	})
}

afterEach(() => {
	vi.clearAllMocks()
})

describe('pruneProjectBackups', () => {
	it('prunes the project dump bucket and reports the counts', async () => {
		prunePostgresBackupsMock.mockResolvedValue({ scanned: 20, pruned: 6 })

		const outcome = await pruneProjectBackups(INFRA_STORAGE, 'acme-web')

		expect(outcome).toEqual({
			project: 'acme-web',
			scanned: 20,
			pruned: 6,
			bucketMissing: false,
		})
		const [, bucket] = prunePostgresBackupsMock.mock.calls[0] ?? []
		expect(bucket).toBe('acme-web-backups-dump')
	})

	it('treats a missing bucket as "nothing to prune" (non-postgres project)', async () => {
		prunePostgresBackupsMock.mockRejectedValue(
			new NoSuchBucket({ $metadata: {}, message: 'no such bucket' }),
		)

		const outcome = await pruneProjectBackups(INFRA_STORAGE, 'static-site')

		expect(outcome).toEqual({
			project: 'static-site',
			scanned: 0,
			pruned: 0,
			bucketMissing: true,
		})
	})

	it('rethrows non-NoSuchBucket failures rather than masking them as clean', async () => {
		prunePostgresBackupsMock.mockRejectedValue(new Error('AccessDenied'))

		await expect(
			pruneProjectBackups(INFRA_STORAGE, 'acme-web'),
		).rejects.toThrow('AccessDenied')
	})
})

describe('pruneBackupsCommand', () => {
	it('enumerates projects from the fleet state and prunes each unique one', async () => {
		loadR2RuntimeMock.mockResolvedValue(INFRA_STORAGE)
		listKeysMock.mockResolvedValue([
			'hetzner/vps-a.json',
			'hetzner/vps-b.json',
			'hetzner/not-a-state.txt',
		])
		getMock.mockImplementation(async (key: string) => {
			if (key === 'hetzner/vps-a.json') {
				return { body: stateJson(['proj-1', 'proj-2']), etag: '"e"' }
			}
			if (key === 'hetzner/vps-b.json') {
				return { body: stateJson(['proj-2', 'proj-3']), etag: '"e"' }
			}
			return null
		})
		prunePostgresBackupsMock.mockResolvedValue({ scanned: 10, pruned: 2 })

		await pruneBackupsCommand()

		// proj-2 appears on both VPS state files but is pruned once (deduped).
		const prunedProjects = prunePostgresBackupsMock.mock.calls
			.map((call: unknown[]) => String(call[1]))
			.toSorted((a, b) => a.localeCompare(b))
		expect(prunedProjects).toEqual([
			'proj-1-backups-dump',
			'proj-2-backups-dump',
			'proj-3-backups-dump',
		])
		// Only the two well-formed state keys were read (not the .txt object).
		expect(getMock).toHaveBeenCalledTimes(2)
		expect(writeSummaryMock).toHaveBeenCalledOnce()
	})

	it('writes a summary and prunes nothing when the fleet has no state files', async () => {
		loadR2RuntimeMock.mockResolvedValue(INFRA_STORAGE)
		listKeysMock.mockResolvedValue([])

		await pruneBackupsCommand()

		expect(prunePostgresBackupsMock).not.toHaveBeenCalled()
		expect(writeSummaryMock).toHaveBeenCalledOnce()
	})
})
