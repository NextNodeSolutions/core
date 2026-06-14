import { afterEach, describe, expect, it, vi } from 'vitest'

import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'

const resolveR2PermissionGroupIdsMock = vi.hoisted(() => vi.fn())
const createR2TokenMock = vi.hoisted(() => vi.fn())
const awaitTokenPropagationMock = vi.hoisted(() => vi.fn())
const revokeStaleTokensMock = vi.hoisted(() => vi.fn())
const readPostgresBackupStateMock = vi.hoisted(() => vi.fn())
const writePostgresBackupStateMock = vi.hoisted(() => vi.fn())

vi.mock('#/adapters/cloudflare/permission-groups.ts', () => ({
	resolveR2PermissionGroupIds: resolveR2PermissionGroupIdsMock,
}))
vi.mock('#/adapters/cloudflare/r2/tokens.ts', () => ({
	createR2Token: createR2TokenMock,
}))
vi.mock('#/cli/r2/token-lifecycle.ts', () => ({
	awaitTokenPropagation: awaitTokenPropagationMock,
	revokeStaleTokens: revokeStaleTokensMock,
}))
vi.mock('#/adapters/services/postgres-backup-state.ts', () => ({
	readPostgresBackupState: readPostgresBackupStateMock,
	writePostgresBackupState: writePostgresBackupStateMock,
}))
vi.mock('#/adapters/r2/client.ts', () => ({ R2Client: vi.fn() }))

import {
	loadPostgresBackupCreds,
	provisionPostgresBackupCreds,
} from './postgres-backup-creds.ts'

const INFRA_STORAGE: InfraStorageRuntimeConfig = {
	accountId: 'acct',
	endpoint: 'https://acct.r2.cloudflarestorage.com',
	accessKeyId: 'infra-key',
	secretAccessKey: 'infra-secret',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
}

afterEach(() => {
	vi.clearAllMocks()
})

describe('provisionPostgresBackupCreds', () => {
	it('mints one token scoped to both backup buckets, propagates, revokes stale, persists state', async () => {
		resolveR2PermissionGroupIdsMock.mockResolvedValue({
			read: 'r',
			write: 'w',
		})
		createR2TokenMock.mockResolvedValue({
			id: 'tok-id',
			value: 'tok-value',
		})
		awaitTokenPropagationMock.mockResolvedValue(undefined)
		revokeStaleTokensMock.mockResolvedValue(undefined)
		writePostgresBackupStateMock.mockResolvedValue(undefined)

		await provisionPostgresBackupCreds({
			cfToken: 'cf',
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
			bucketNames: ['myapp-backups', 'myapp-backups-dump'],
		})

		expect(createR2TokenMock).toHaveBeenCalledWith({
			token: 'cf',
			tokenName: 'nextnode-postgres-backup-myapp-production',
			accountId: 'acct',
			bucketNames: ['myapp-backups', 'myapp-backups-dump'],
			permissions: { read: 'r', write: 'w' },
		})
		// Propagation is probed against the first (wal-g) bucket only.
		expect(awaitTokenPropagationMock).toHaveBeenCalledWith(
			expect.objectContaining({
				probeBucket: 'myapp-backups',
				accessKeyId: 'tok-id',
			}),
		)
		expect(revokeStaleTokensMock).toHaveBeenCalledWith(
			'cf',
			'nextnode-postgres-backup-myapp-production',
			'tok-id',
		)
		const [writeCall] = writePostgresBackupStateMock.mock.calls
		expect(writeCall?.[1]).toBe(
			'services/postgres-backup/myapp/production.json',
		)
		expect(writeCall?.[2]).toEqual({
			endpoint: INFRA_STORAGE.endpoint,
			accessKeyId: 'tok-id',
			secretAccessKey: expect.any(String),
		})
	})

	it('throws when bucketNames is empty rather than minting an unscoped token', async () => {
		await expect(
			provisionPostgresBackupCreds({
				cfToken: 'cf',
				infraStorage: INFRA_STORAGE,
				projectName: 'myapp',
				environment: 'production',
				bucketNames: [],
			}),
		).rejects.toThrow('bucketNames must not be empty')
		expect(createR2TokenMock).not.toHaveBeenCalled()
	})
})

describe('loadPostgresBackupCreds', () => {
	it('returns the persisted creds', async () => {
		const creds = {
			endpoint: INFRA_STORAGE.endpoint,
			accessKeyId: 'bk-key',
			secretAccessKey: 'bk-secret',
		}
		readPostgresBackupStateMock.mockResolvedValue(creds)

		const loaded = await loadPostgresBackupCreds({
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
		})

		expect(loaded).toEqual(creds)
	})

	it('throws when no state has been persisted (provision not run)', async () => {
		readPostgresBackupStateMock.mockResolvedValue(null)

		await expect(
			loadPostgresBackupCreds({
				infraStorage: INFRA_STORAGE,
				projectName: 'myapp',
				environment: 'production',
			}),
		).rejects.toThrow(/run provision before deploy/)
	})
})
