import { Buffer } from 'node:buffer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { PostgresBackupSnapshot } from '#/domain/services/postgres.ts'

const loadR2RuntimeMock = vi.hoisted(() => vi.fn())
const listSnapshotsMock = vi.hoisted(() => vi.fn())
const listKeysMock = vi.hoisted(() => vi.fn())
const getMock = vi.hoisted(() => vi.fn())
const createSshSessionMock = vi.hoisted(() => vi.fn())
const executeRestoreAtMock = vi.hoisted(() => vi.fn())
const sessionCloseMock = vi.hoisted(() => vi.fn())

vi.mock('#/cli/r2/load-runtime.ts', () => ({
	loadR2Runtime: loadR2RuntimeMock,
}))
vi.mock('#/adapters/r2/backup-store.ts', () => ({
	listPostgresBackupSnapshots: listSnapshotsMock,
}))
vi.mock('#/adapters/r2/client.ts', () => ({
	R2Client: vi.fn(() => ({ listKeys: listKeysMock, get: getMock })),
}))
vi.mock('#/adapters/hetzner/ssh/session.ts', () => ({
	createSshSession: createSshSessionMock,
}))
vi.mock('#/adapters/hetzner/restore.ts', () => ({
	executeRestoreAt: executeRestoreAtMock,
}))

import { restoreCommand } from './restore.command.ts'

const INFRA_STORAGE: InfraStorageRuntimeConfig = {
	accountId: 'acct',
	endpoint: 'https://acct.r2.cloudflarestorage.com',
	accessKeyId: 'r2-key',
	secretAccessKey: 'r2-secret',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
}

function snap(iso: string): PostgresBackupSnapshot {
	return { key: `postgres/acme_${iso}.dump`, timestamp: new Date(`${iso}Z`) }
}

function convergedStateJson(projects: ReadonlyArray<string>): string {
	const hostPorts: Record<string, Record<string, number>> = {}
	for (const project of projects) hostPorts[project] = { app: 8080 }
	return JSON.stringify({
		phase: 'converged',
		serverId: 1,
		publicIp: '1.2.3.4',
		tailnetIp: '100.64.0.1',
		convergedAt: '2026-01-01T00:00:00Z',
		sshHostKeyFingerprint: 'abcdef',
		hostPorts,
	})
}

function setArgv(...flags: ReadonlyArray<string>): void {
	process.argv = ['node', 'index.ts', 'restore', ...flags]
}

beforeEach(() => {
	vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
	vi.stubEnv(
		'DEPLOY_SSH_PRIVATE_KEY_B64',
		Buffer.from('fake-private-key').toString('base64'),
	)
	loadR2RuntimeMock.mockResolvedValue(INFRA_STORAGE)
	createSshSessionMock.mockResolvedValue({ close: sessionCloseMock })
	executeRestoreAtMock.mockResolvedValue(undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.clearAllMocks()
})

describe('restoreCommand', () => {
	it('selects the closest dump <= --at, resolves the VPS, and restores it in the sidecar over SSH', async () => {
		setArgv('--project', 'acme', '--at', '2026-05-16T12:00:00', '--yes')
		listSnapshotsMock.mockResolvedValue([
			snap('2026-05-16T03:00:00'),
			snap('2026-05-16T20:00:00'),
		])
		listKeysMock.mockResolvedValue(['hetzner/vps-a.json'])
		getMock.mockResolvedValue({
			body: convergedStateJson(['acme']),
			etag: '"e"',
		})

		await restoreCommand()

		// The dump bucket follows the rename.
		expect(listSnapshotsMock).toHaveBeenCalledWith(
			expect.anything(),
			'acme-backups-dump',
		)
		// SSH targets the VPS tailnet IP as the deploy user. The host-key
		// fingerprint is whatever readState surfaces (undefined today -> TOFU,
		// the same posture as deploy/migrate's openVpsSession).
		expect(createSshSessionMock).toHaveBeenCalledWith({
			host: '100.64.0.1',
			username: 'deploy',
			privateKey: 'fake-private-key',
			expectedHostKeyFingerprint: undefined,
		})
		// The 03:00 dump is restored (closest <= 12:00), as its exact key segment.
		expect(executeRestoreAtMock).toHaveBeenCalledWith(
			{ close: sessionCloseMock },
			{ projectName: 'acme', environment: 'production' },
			'2026-05-16T03:00:00',
		)
		expect(sessionCloseMock).toHaveBeenCalledOnce()
	})

	it('refuses without --yes (the destructive pg_restore --clean gate)', async () => {
		setArgv('--project', 'acme', '--at', '2026-05-16T12:00:00')

		await expect(restoreCommand()).rejects.toThrow(/--yes/)
		expect(createSshSessionMock).not.toHaveBeenCalled()
		expect(executeRestoreAtMock).not.toHaveBeenCalled()
	})

	it('throws when no dump exists on or before --at', async () => {
		setArgv('--project', 'acme', '--at', '2026-05-16T00:00:00', '--yes')
		listSnapshotsMock.mockResolvedValue([snap('2026-05-16T03:00:00')])

		await expect(restoreCommand()).rejects.toThrow(/no backup found/)
		expect(executeRestoreAtMock).not.toHaveBeenCalled()
	})

	it('throws when no provisioned VPS hosts the project', async () => {
		setArgv('--project', 'acme', '--at', '2026-05-16T12:00:00', '--yes')
		listSnapshotsMock.mockResolvedValue([snap('2026-05-16T03:00:00')])
		listKeysMock.mockResolvedValue(['hetzner/vps-a.json'])
		getMock.mockResolvedValue({
			body: convergedStateJson(['some-other-project']),
			etag: '"e"',
		})

		await expect(restoreCommand()).rejects.toThrow(/no provisioned VPS/)
		expect(createSshSessionMock).not.toHaveBeenCalled()
	})
})
