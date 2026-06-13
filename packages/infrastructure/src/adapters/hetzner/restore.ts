import {
	assertDbPopulatedAfterRestore,
	parsePsqlTableCount,
	planAutoRestore,
} from '#/domain/deploy/auto-restore.ts'
import { computeSilo } from '#/domain/hetzner/env-silo.ts'
import {
	POSTGRES_BACKUP_SERVICE_NAME,
	POSTGRES_SIDECAR_SERVICE_NAME,
	postgresProjectIdentifier,
} from '#/domain/services/postgres.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { shellEscape } from './ssh/shell-escape.ts'

import type {
	AutoRestoreInput,
	AutoRestoreResult,
} from '#/domain/deploy/auto-restore.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { SshSession } from './ssh/session.types.ts'

const logger = createLogger()

export interface RestoreTargetRef {
	readonly projectName: string
	readonly environment: AppEnvironment
}

/**
 * SQL that counts user tables - every table outside the two reserved
 * system schemas. A freshly `initdb`-ed database has zero; any migrated or
 * seeded database has at least one (e.g. drizzle's `__drizzle_migrations`).
 * This single number is the empty-vs-populated signal the restore decision
 * turns on, so it must be conservative: tables in ANY user schema (public
 * or custom) count, so a populated database can never read as empty.
 */
const USER_TABLE_COUNT_SQL =
	"SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')"

function composeFilePath(ref: RestoreTargetRef): string {
	return `/opt/apps/${ref.projectName}/${ref.environment}/compose.yaml`
}

/**
 * Pure command builder. Renders the docker compose invocation that probes
 * the live embedded database for its user-table count, run inside the
 * already-healthy `postgres` container:
 *
 *   docker compose -p <silo> -f <composeFile> exec -T postgres \
 *     psql -U <id> -d <id> -tAc '<count sql>'
 *
 * `exec -T` reuses the running server container (no new process image),
 * connects over the local unix socket as the project superuser (the
 * official image's default `local all all trust`, so no password is
 * needed), and `-tAc` makes psql print just the integer. `-T` disables the
 * pseudo-TTY because we run over SSH from a non-interactive runner.
 */
export function buildTableCountCommand(ref: RestoreTargetRef): string {
	const silo = computeSilo(ref.projectName, ref.environment)
	const id = postgresProjectIdentifier(ref.projectName)

	return [
		'docker',
		'compose',
		'-p',
		shellEscape(silo.id),
		'-f',
		shellEscape(composeFilePath(ref)),
		'exec',
		'-T',
		POSTGRES_SIDECAR_SERVICE_NAME,
		'psql',
		'-U',
		shellEscape(id),
		'-d',
		shellEscape(id),
		'-tAc',
		shellEscape(USER_TABLE_COUNT_SQL),
	].join(' ')
}

/**
 * Pure command builder. Renders the docker compose invocation that restores
 * the LATEST R2 dump into the embedded database via the backup sidecar:
 *
 *   docker compose -p <silo> -f <composeFile> exec -T postgres-backup sh restore.sh
 *
 * Symmetric with the pre-migrate snapshot's `backup.sh`: `exec -T` runs in
 * the existing `postgres-backup` container (already up via `bringUpDb`),
 * reusing its env (R2 creds, S3_BUCKET, POSTGRES_*). `restore.sh` with no
 * argument finds the most-recent dump under the bucket prefix, downloads it
 * and runs `pg_restore --clean --if-exists`. Safe only against an empty
 * database - the caller gates on the table-count probe first.
 */
export function buildLatestRestoreCommand(ref: RestoreTargetRef): string {
	const silo = computeSilo(ref.projectName, ref.environment)

	return [
		'docker',
		'compose',
		'-p',
		shellEscape(silo.id),
		'-f',
		shellEscape(composeFilePath(ref)),
		'exec',
		'-T',
		POSTGRES_BACKUP_SERVICE_NAME,
		'sh',
		'restore.sh',
	].join(' ')
}

/**
 * Probe the live database for its user-table count over SSH. `session.exec`
 * resolves with stdout only (psql NOTICEs go to stderr), so the returned
 * string is the bare integer the domain parser validates. A non-zero psql
 * exit rejects from `session.exec`, halting the deploy rather than guessing.
 */
export async function probeUserTableCount(
	session: SshSession,
	ref: RestoreTargetRef,
): Promise<number> {
	const stdout = await session.exec(buildTableCountCommand(ref))
	return parsePsqlTableCount(stdout)
}

/**
 * Restore the latest R2 dump into the database via the backup sidecar over
 * SSH. Failure modes (non-zero exit, transport error) propagate from
 * `session.exec`. Because `restore.sh` itself omits `set -e`, the caller
 * must additionally re-probe and assert the database is now populated
 * (`assertDbPopulatedAfterRestore`) to catch a silent restore failure.
 */
export async function executeLatestRestore(
	session: SshSession,
	ref: RestoreTargetRef,
): Promise<void> {
	logger.info(
		`Restoring latest R2 dump into "${ref.projectName}" (${ref.environment}) via the backup sidecar`,
	)
	await session.exec(buildLatestRestoreCommand(ref))
}

/**
 * Orchestrate auto-restore over an open SSH session: probe the live
 * database, ask the domain whether to restore, and - only when it says so -
 * restore the latest dump and re-probe to confirm tables actually
 * materialised (fail loud otherwise). Thin session-lifecycle wrapping lives
 * in `HetznerVpsTarget.runAutoRestore`, mirroring `executeMigrate` /
 * `executeSnapshot`; the decision itself stays pure in `planAutoRestore`.
 */
export async function executeAutoRestore(
	session: SshSession,
	input: AutoRestoreInput,
): Promise<AutoRestoreResult> {
	const start = Date.now()
	const tableCountBefore = await probeUserTableCount(session, input)
	const action = planAutoRestore({
		tableCountBefore,
		snapshotCount: input.snapshotCount,
	})

	if (action !== 'restore') {
		return {
			action,
			tableCountBefore,
			tableCountAfter: null,
			durationMs: Date.now() - start,
		}
	}

	await executeLatestRestore(session, input)
	const tableCountAfter = await probeUserTableCount(session, input)
	assertDbPopulatedAfterRestore(tableCountAfter)
	return {
		action,
		tableCountBefore,
		tableCountAfter,
		durationMs: Date.now() - start,
	}
}
