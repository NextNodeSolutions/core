import { writeSummary } from '#/adapters/github/output.ts'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { isHetznerDeployableConfig } from '#/config/types.ts'
import {
	resolveSoleService,
	selectServiceImage,
} from '#/domain/deploy/image-ref.ts'
import { buildMigrateSummary } from '#/domain/deploy/migrate-summary.ts'
import { DEFAULT_MIGRATE_COMMAND } from '#/domain/deploy/target.ts'

import { resolveDeployContext } from './resolve-deploy-context.ts'

import type { DeployableConfig } from '#/config/types.ts'
import type { MigrateInput } from '#/domain/deploy/target.ts'

/**
 * `migrate-remote` orchestrates Path A's migrate phase. It runs in its
 * own GH Actions job between `provision` and `deploy`, so a failure
 * here halts the workflow BEFORE the app rotates against an
 * unmigrated schema.
 *
 * Steps:
 *   1. Stage the rollout on the target — env file, compose file,
 *      registry login, image pull, postgres up + healthy.
 *   2. Trigger an on-demand snapshot via the backup sidecar so the
 *      forward-only migration has a known-good restore point. Skipped
 *      when `[services.postgres].mode = "external"` (user owns backups).
 *   3. Run the migrate command in an ephemeral container joined to
 *      the project's docker network (postgres reachable internally,
 *      never bound on the host).
 *
 * The snapshot is the rollback safety net: a failure there halts the
 * workflow before migrate runs. A migration failure does NOT delete the
 * snapshot — it stays in R2 for `infrastructure restore`, which picks
 * the right dump by timestamp (most-recent ≤ deploy time). Skipped
 * (early-exit) when the project does not declare `[services.postgres]`.
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

	if (!isHetznerDeployableConfig(config) || !input.images) {
		throw new Error(
			'migrate-remote: a hetzner-vps target with images is required (postgres-backed apps run on a container target)',
		)
	}
	const { name } = resolveSoleService(config.deploy.services)
	const migrateImage = selectServiceImage(input.images, name)

	await target.prepareRollout(config.project.name, input, env)

	let snapshotDurationMs: number | null = null
	if (postgres.mode === 'embedded') {
		const snapshot = await target.runPreMigrateSnapshot({
			projectName: config.project.name,
			environment,
		})
		snapshotDurationMs = snapshot.durationMs
		logger.info(
			`Pre-migrate snapshot for "${config.project.name}" completed in ${String(snapshot.durationMs)}ms`,
		)
	}

	const migrateInput: MigrateInput = {
		projectName: config.project.name,
		environment,
		image: migrateImage,
		migrateCommand: postgres.migrateCommand ?? DEFAULT_MIGRATE_COMMAND,
	}

	const result = await target.runMigrate(migrateInput)
	logger.info(
		`Migration applied for "${config.project.name}" in ${result.durationMs}ms`,
	)

	writeSummary(
		buildMigrateSummary({
			projectName: config.project.name,
			environment,
			migrateDurationMs: result.durationMs,
			snapshotDurationMs,
		}),
	)
}
