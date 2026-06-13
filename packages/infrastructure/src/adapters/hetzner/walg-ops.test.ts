import { describe, expect, it, vi } from 'vitest'

import {
	buildWalgFinalBackupCommand,
	executeWalgFinalBackup,
} from './migrate.ts'

import type { SnapshotInput } from '#/domain/deploy/target.ts'
import type { SshSession } from './ssh/session.types.ts'

const INPUT: SnapshotInput = {
	projectName: 'acme-web',
	environment: 'production',
}

function recordingSession(exec: SshSession['exec']): SshSession {
	return {
		exec,
		execWithStdin: vi.fn(async () => ''),
		writeFile: vi.fn(async () => undefined),
		readFile: vi.fn(async () => null),
		close: vi.fn(),
		hostKeyFingerprint: 'test-fingerprint',
	}
}

describe('buildWalgFinalBackupCommand', () => {
	it('renders a wal-g backup-push exec against the postgres-walg sidecar', () => {
		expect(buildWalgFinalBackupCommand(INPUT)).toBe(
			"docker compose -p 'acme-web-production'" +
				" -f '/opt/apps/acme-web/production/compose.yaml'" +
				" exec -T postgres-walg wal-g backup-push '/var/lib/postgresql/18/docker'",
		)
	})

	it('derives the silo + compose path from the development environment', () => {
		const command = buildWalgFinalBackupCommand({
			...INPUT,
			environment: 'development',
		})

		expect(command).toContain("-p 'acme-web-development'")
		expect(command).toContain(
			"-f '/opt/apps/acme-web/development/compose.yaml'",
		)
	})

	it('shell-escapes a malicious project name', () => {
		const command = buildWalgFinalBackupCommand({
			...INPUT,
			projectName: 'acme;rm -rf /',
		})

		expect(command).toContain("-p 'acme;rm -rf /-production'")
	})

	it('uses `exec -T` so the sidecar runs without a pseudo-TTY', () => {
		expect(buildWalgFinalBackupCommand(INPUT)).toMatch(
			/exec -T postgres-walg wal-g backup-push /,
		)
	})
})

describe('executeWalgFinalBackup', () => {
	it('runs the backup-push command over SSH and returns a duration', async () => {
		const exec = vi.fn(async () => '')
		const session = recordingSession(exec)

		const outcome = await executeWalgFinalBackup(session, INPUT)

		expect(exec).toHaveBeenCalledExactlyOnceWith(
			buildWalgFinalBackupCommand(INPUT),
		)
		expect(outcome.durationMs).toBeGreaterThanOrEqual(0)
	})

	it('propagates a failure so the teardown aborts rather than destroying data', async () => {
		const exec = vi.fn(async () => {
			throw new Error('backup-push exited 1')
		})
		const session = recordingSession(exec)

		await expect(executeWalgFinalBackup(session, INPUT)).rejects.toThrow(
			'backup-push exited 1',
		)
	})
})
