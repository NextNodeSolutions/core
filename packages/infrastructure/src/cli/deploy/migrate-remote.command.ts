import { writeSummary } from '#/adapters/github/output.ts'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { isHetznerDeployableConfig } from '#/config/types.ts'
import { selectServiceImage } from '#/domain/deploy/image-ref.ts'
import { buildMigrateSummary } from '#/domain/deploy/migrate-summary.ts'
import { resolveMigrationServiceName } from '#/domain/deploy/migration-service.ts'
import { DEFAULT_MIGRATE_COMMAND } from '#/domain/deploy/target.ts'

import { pruneProjectBackups } from './prune-backups.ts'
import { resolveDeployContext } from './resolve-deploy-context.ts'

import type { DeployableConfig } from '#/config/types.ts'
import type { MigrateInput } from '#/domain/deploy/target.ts'

/**
 * `migrate-remote` orchestrates Path A's migrate phase. It runs in its own GH
 * Actions job between `provision` and `deploy`, so a failure here halts the
 * workflow BEFORE the app rotates against an unmigrated schema.
 *
 * Steps:
 *   1. Stage the rollout on the target - env file, compose file, registry
 *      login, image pull, postgres up + healthy. On a fresh VPS the wal-g
 *      image entrypoint restores the latest base backup + replays archived WAL
 *      before postgres reports healthy, so migrate runs on the rehydrated
 *      schema (zero-loss VPS swap).
 *   2. Run the migrate command in an ephemeral container joined to the
 *      project's docker network (postgres reachable internally, never bound on
 *      the host).
 *
 * No pre-migrate snapshot is taken: continuous WAL archiving (archive_command,
 * RPO <=180s) plus the periodic base backups already capture the pre-migration
 * state for a wal-g point-in-time recovery (operator-run, a separate follow-up,
 * not this command). NOTE: `infrastructure restore --at <ts>` is the pg_dump
 * LOGICAL restore - it replays the closest daily dump on the VPS, it is NOT a
 * WAL-G PITR. Skipped (early-exit) when the project does not declare
 * `[services.postgres]`.
 */
export async function migrateRemoteCommand(
	config: DeployableConfig,
): Promise<void> {
	const { postgres } = config.services
	if (!postgres) {
		logger.info(
			`Skipping migrate-remote: no [services.postgres] for "${config.project.name}"`,
		)
		return
	}

	const { target, env, input, environment, infraStorage } =
		await resolveDeployContext(config)

	if (!isHetznerDeployableConfig(config) || !input.images) {
		throw new Error(
			'migrate-remote: a hetzner-vps target with images is required (postgres-backed apps run on a container target)',
		)
	}
	const migrateServiceName = resolveMigrationServiceName(
		config.deploy.services,
	)
	const migrateImage = selectServiceImage(input.images, migrateServiceName)

	await target.prepareRollout(config.project.name, input, env)

	const migrateInput: MigrateInput = {
		projectName: config.project.name,
		environment,
		image: migrateImage,
		migrateCommand: postgres.migrateCommand ?? DEFAULT_MIGRATE_COMMAND,
	}

	const migrateResult = await target.runMigrate(migrateInput)
	logger.info(
		`Migration applied for "${config.project.name}" in ${migrateResult.durationMs}ms`,
	)

	// Belt-and-suspenders GFS prune of the pg_dump bucket on every deploy, so
	// retention holds even between daily cron runs. Embedded-only: external mode
	// has no NextNode-owned dump bucket. wal-g manages its own retention.
	if (postgres.mode === 'embedded' && infraStorage !== null) {
		await pruneProjectBackups(infraStorage, config.project.name)
	}

	writeSummary(
		buildMigrateSummary({
			projectName: config.project.name,
			environment,
			migrateDurationMs: migrateResult.durationMs,
			snapshotDurationMs: null,
		}),
	)
}
