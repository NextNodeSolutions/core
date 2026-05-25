import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import type { DeployableConfig } from '#/config/types.ts'
import type { MigrateInput } from '#/domain/deploy/target.ts'
import { DEFAULT_MIGRATE_COMMAND } from '#/domain/deploy/target.ts'

import { resolveDeployContext } from './resolve-deploy-context.ts'

/**
 * `migrate-remote` orchestrates Path A's migrate phase. It runs in its
 * own GH Actions job between `provision` and `deploy`, so a failure
 * here halts the workflow BEFORE the app rotates against an
 * unmigrated schema.
 *
 * Steps:
 *   1. Stage the rollout on the target — env file, compose file,
 *      registry login, image pull, postgres up + healthy.
 *   2. Run the migrate command in an ephemeral container joined to
 *      the project's docker network (postgres reachable internally,
 *      never bound on the host).
 *
 * Skipped (early-exit) when the project does not declare
 * `[services.postgres]`. Adding the snapshot backup step between (1)
 * and (2) is INT-600 / P8-11.
 */
export async function migrateRemoteCommand(
	config: DeployableConfig,
): Promise<void> {
	const postgres = config.services.postgres
	if (!postgres) {
		logger.info(
			`Skipping migrate-remote: no [services.postgres] for "${config.project.name}"`,
		)
		return
	}

	const { target, env, input, environment } =
		await resolveDeployContext(config)

	if (!input.image) {
		throw new Error(
			'migrate-remote: image is required (postgres-backed apps must run on a container target)',
		)
	}

	await target.prepareRollout(config.project.name, input, env)

	const migrateInput: MigrateInput = {
		projectName: config.project.name,
		environment,
		image: input.image,
		migrateCommand: postgres.migrateCommand ?? DEFAULT_MIGRATE_COMMAND,
	}

	const result = await target.runMigrate(migrateInput)
	logger.info(
		`Migration applied for "${config.project.name}" in ${result.durationMs}ms`,
	)
}
