import { formatImageRef } from '#/domain/hetzner/compose-file.ts'
import { computeSilo } from '#/domain/hetzner/env-silo.ts'
import { POSTGRES_BACKUP_SERVICE_NAME } from '#/domain/services/postgres.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { shellEscape } from './ssh/shell-escape.ts'

import type {
	ImageRef,
	MigrateInput,
	MigrateResult,
	SnapshotInput,
	SnapshotResult,
} from '#/domain/deploy/target.ts'
import type { SshSession } from './ssh/session.types.ts'

const logger = createLogger()

export interface MigrateCommandFields {
	readonly network: string
	readonly envFile: string
	readonly image: ImageRef
	readonly migrateCommand: string
}

export interface BuildMigrateCommandResult {
	readonly command: string
	readonly fields: MigrateCommandFields
}

/**
 * Pure command builder. Renders the `docker run` invocation that spawns
 * an ephemeral migrate container on the VPS via SSH:
 *
 *   docker run --rm --network <silo>_default --env-file <envDir>/.env <image-ref> sh -c <migrate_command>
 *
 * The `--rm` container joins the project's docker network so the embedded
 * postgres sidecar resolves at its compose service name (`postgres:5432`),
 * never exposed on the host. The image-ref must equal the app image so
 * migrations and runtime code share the same `node_modules`. Every
 * interpolated field is single-quote-escaped to neutralise shell
 * metacharacters in user-supplied values.
 *
 * Not a compose sidecar — Path A explicitly avoids adding a `migrate`
 * service to `compose.yaml`. This is an SSH-orchestrated one-shot.
 */
export function buildMigrateCommand(
	input: MigrateInput,
): BuildMigrateCommandResult {
	const silo = computeSilo(input.projectName, input.environment)
	const network = `${silo.id}_default`
	const envFile = `/opt/apps/${input.projectName}/${input.environment}/.env`
	const imageRef = formatImageRef(input.image)

	const command = [
		'docker',
		'run',
		'--rm',
		'--network',
		shellEscape(network),
		'--env-file',
		shellEscape(envFile),
		shellEscape(imageRef),
		'sh',
		'-c',
		shellEscape(input.migrateCommand),
	].join(' ')

	return {
		command,
		fields: {
			network,
			envFile,
			image: input.image,
			migrateCommand: input.migrateCommand,
		},
	}
}

/**
 * Execute the migrate command on the VPS via SSH. Returns the durationMs
 * so the caller can surface it in deploy summaries. Failure modes
 * (non-zero exit, SSH transport error) propagate from `session.exec`.
 */
export async function executeMigrate(
	session: SshSession,
	input: MigrateInput,
): Promise<MigrateResult> {
	const start = Date.now()
	const { command } = buildMigrateCommand(input)
	logger.info(
		`Running migrate for "${input.projectName}" (${input.environment}) inside ephemeral container`,
	)
	await session.exec(command)
	const durationMs = Date.now() - start
	logger.info(
		`Migrate succeeded for "${input.projectName}" (${input.environment}) in ${String(durationMs)}ms`,
	)
	return { durationMs }
}

export interface SnapshotCommandFields {
	readonly composeFile: string
	readonly siloId: string
	readonly serviceName: string
	readonly script: string
}

export interface BuildSnapshotCommandResult {
	readonly command: string
	readonly fields: SnapshotCommandFields
}

/**
 * Pure command builder. Renders the docker compose invocation that triggers
 * an ad-hoc dump inside the running backup sidecar:
 *
 *   docker compose -p <silo> -f <composeFile> exec -T postgres-backup sh backup.sh
 *
 * `exec -T` runs in the existing `postgres-backup` container (already up
 * via `bringUpDb`), reusing its env (R2 creds, S3_BUCKET, etc.) — no new
 * container, no fresh credentials. `-T` disables pseudo-TTY allocation
 * because we are invoked over SSH from a non-interactive runner.
 */
export function buildSnapshotCommand(
	input: SnapshotInput,
): BuildSnapshotCommandResult {
	const silo = computeSilo(input.projectName, input.environment)
	const composeFile = `/opt/apps/${input.projectName}/${input.environment}/compose.yaml`

	const command = [
		'docker',
		'compose',
		'-p',
		shellEscape(silo.id),
		'-f',
		shellEscape(composeFile),
		'exec',
		'-T',
		POSTGRES_BACKUP_SERVICE_NAME,
		'sh',
		'backup.sh',
	].join(' ')

	return {
		command,
		fields: {
			composeFile,
			siloId: silo.id,
			serviceName: POSTGRES_BACKUP_SERVICE_NAME,
			script: 'backup.sh',
		},
	}
}

/**
 * Trigger the backup sidecar via SSH. Failure modes (non-zero exit,
 * transport error) propagate as thrown errors — the snapshot is the
 * rollback safety net for `runMigrate`, so the orchestrator MUST halt
 * the deploy before migrate runs when this fails. The dump itself is
 * identified by its timestamped R2 key (written by the sidecar);
 * `infrastructure restore --at <deploy-time>` picks it without us
 * having to track the key client-side.
 */
export async function executeSnapshot(
	session: SshSession,
	input: SnapshotInput,
): Promise<SnapshotResult> {
	const start = Date.now()
	const { command } = buildSnapshotCommand(input)
	logger.info(
		`Triggering pre-migrate snapshot for "${input.projectName}" (${input.environment})`,
	)
	await session.exec(command)
	const durationMs = Date.now() - start
	logger.info(
		`Pre-migrate snapshot uploaded for "${input.projectName}" (${input.environment}) in ${String(durationMs)}ms`,
	)
	return { durationMs }
}
