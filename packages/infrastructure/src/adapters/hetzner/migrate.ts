import type {
	ImageRef,
	MigrateInput,
	MigrateResult,
} from '#/domain/deploy/target.ts'
import { formatImageRef } from '#/domain/hetzner/compose-file.ts'
import { computeSilo } from '#/domain/hetzner/env-silo.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { SshSession } from './ssh/session.types.ts'
import { shellEscape } from './ssh/shell-escape.ts'

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
