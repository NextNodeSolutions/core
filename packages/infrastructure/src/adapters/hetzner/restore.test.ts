import { describe, expect, it } from 'vitest'

import {
	buildLatestRestoreCommand,
	buildRestoreAtCommand,
	buildTableCountCommand,
	executeAutoRestore,
	executeLatestRestore,
	executeRestoreAt,
	probeUserTableCount,
} from './restore.ts'
import { shellEscape } from './ssh/shell-escape.ts'

import type { AutoRestoreInput } from '#/domain/deploy/auto-restore.ts'
import type { RestoreTargetRef } from './restore.ts'
import type { SshSession } from './ssh/session.types.ts'

const REF: RestoreTargetRef = {
	projectName: 'acme-web',
	environment: 'production',
}

// The exact SQL the probe runs, duplicated so the test pins both the command
// shape AND that the single quotes around the system-schema names survive
// shell-escaping intact.
const USER_TABLE_COUNT_SQL =
	"SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')"

function stubSession(exec: (command: string) => Promise<string>): SshSession {
	return {
		exec,
		execWithStdin: () => Promise.reject(new Error('unused in test')),
		writeFile: () => Promise.resolve(),
		readFile: () => Promise.resolve(null),
		close: () => {},
		hostKeyFingerprint: 'sha256:test',
	}
}

describe('buildTableCountCommand', () => {
	it('execs psql in the running postgres container with the escaped count SQL', () => {
		expect(buildTableCountCommand(REF)).toBe(
			"docker compose -p 'acme-web-production'" +
				" -f '/opt/apps/acme-web/production/compose.yaml'" +
				" exec -T postgres psql -U 'acme_web' -d 'acme_web'" +
				` -tAc ${shellEscape(USER_TABLE_COUNT_SQL)}`,
		)
	})

	it('derives the silo and compose path from the environment', () => {
		expect(
			buildTableCountCommand({ ...REF, environment: 'development' }),
		).toContain(
			"docker compose -p 'acme-web-development'" +
				" -f '/opt/apps/acme-web/development/compose.yaml'",
		)
	})
})

describe('buildLatestRestoreCommand', () => {
	it('execs restore.sh in the running backup sidecar', () => {
		expect(buildLatestRestoreCommand(REF)).toBe(
			"docker compose -p 'acme-web-production'" +
				" -f '/opt/apps/acme-web/production/compose.yaml'" +
				' exec -T postgres-backup sh restore.sh',
		)
	})
})

describe('buildRestoreAtCommand', () => {
	it('execs restore.sh with the dump timestamp in the running backup sidecar', () => {
		expect(buildRestoreAtCommand(REF, '2026-05-16T03:00:00')).toBe(
			"docker compose -p 'acme-web-production'" +
				" -f '/opt/apps/acme-web/production/compose.yaml'" +
				" exec -T postgres-backup sh restore.sh '2026-05-16T03:00:00'",
		)
	})

	it('shell-escapes the timestamp so it cannot inject extra arguments', () => {
		expect(
			buildRestoreAtCommand(REF, '2026-05-16T03:00:00; rm -rf /'),
		).toContain(shellEscape('2026-05-16T03:00:00; rm -rf /'))
	})
})

describe('executeRestoreAt', () => {
	it('issues the timestamped restore command it built', async () => {
		let seen = ''
		const session = stubSession(command => {
			seen = command
			return Promise.resolve('')
		})

		await executeRestoreAt(session, REF, '2026-05-16T03:00:00')
		expect(seen).toBe(buildRestoreAtCommand(REF, '2026-05-16T03:00:00'))
	})
})

describe('probeUserTableCount', () => {
	it('runs the count command and parses the integer it returns', async () => {
		let seen = ''
		const session = stubSession(command => {
			seen = command
			return Promise.resolve('2\n')
		})

		await expect(probeUserTableCount(session, REF)).resolves.toBe(2)
		expect(seen).toBe(buildTableCountCommand(REF))
	})

	it('propagates a malformed probe result as a thrown error', async () => {
		const session = stubSession(() => Promise.resolve('not a number'))
		await expect(probeUserTableCount(session, REF)).rejects.toThrow(
			/integer table count/,
		)
	})
})

describe('executeLatestRestore', () => {
	it('issues the restore command it built', async () => {
		let seen = ''
		const session = stubSession(command => {
			seen = command
			return Promise.resolve('')
		})

		await executeLatestRestore(session, REF)
		expect(seen).toBe(buildLatestRestoreCommand(REF))
	})
})

// A session that answers the table-count probe from a scripted queue (one
// entry per probe, in order) and records whether the restore command ran.
function scriptedSession(counts: ReadonlyArray<string>): {
	readonly session: SshSession
	restoreCount: number
} {
	const queue = [...counts]
	const probeCmd = buildTableCountCommand(REF)
	const restoreCmd = buildLatestRestoreCommand(REF)
	const state = { restoreCount: 0 }
	const session = stubSession(command => {
		if (command === probeCmd) {
			const next = queue.shift()
			if (typeof next === 'undefined') {
				return Promise.reject(
					new Error('probe called more than scripted'),
				)
			}
			return Promise.resolve(next)
		}
		if (command === restoreCmd) {
			state.restoreCount += 1
			return Promise.resolve('')
		}
		return Promise.reject(new Error(`unexpected command: ${command}`))
	})
	return {
		session,
		get restoreCount() {
			return state.restoreCount
		},
	}
}

function inputWith(snapshotCount: number): AutoRestoreInput {
	return { ...REF, snapshotCount }
}

describe('executeAutoRestore', () => {
	it('restores then re-probes when the DB is empty and a dump exists', async () => {
		const scripted = scriptedSession(['0\n', '3\n'])

		const outcome = await executeAutoRestore(scripted.session, inputWith(2))

		expect(outcome.action).toBe('restore')
		expect(outcome.tableCountBefore).toBe(0)
		expect(outcome.tableCountAfter).toBe(3)
		expect(outcome.durationMs).toBeGreaterThanOrEqual(0)
		expect(scripted.restoreCount).toBe(1)
	})

	it('never restores a populated database', async () => {
		const scripted = scriptedSession(['5\n'])

		const outcome = await executeAutoRestore(scripted.session, inputWith(9))

		expect(outcome.action).toBe('skip-db-populated')
		expect(outcome.tableCountBefore).toBe(5)
		expect(outcome.tableCountAfter).toBeNull()
		expect(scripted.restoreCount).toBe(0)
	})

	it('starts empty when there is no prior dump', async () => {
		const scripted = scriptedSession(['0\n'])

		const outcome = await executeAutoRestore(scripted.session, inputWith(0))

		expect(outcome.action).toBe('skip-no-backup')
		expect(outcome.tableCountAfter).toBeNull()
		expect(scripted.restoreCount).toBe(0)
	})

	it('fails loud when the DB is still empty after a restore that claimed success', async () => {
		const scripted = scriptedSession(['0\n', '0\n'])

		await expect(
			executeAutoRestore(scripted.session, inputWith(1)),
		).rejects.toThrow(/still empty after restoring/)
		expect(scripted.restoreCount).toBe(1)
	})
})
