import { writeSummary } from '#/adapters/github/output.ts'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import {
	isCloudflareWorkersDeployableConfig,
	isHetznerDeployableConfig,
} from '#/config/types.ts'
import { selectServiceImage } from '#/domain/deploy/image-ref.ts'
import { buildMigrateSummary } from '#/domain/deploy/migrate-summary.ts'
import { resolveMigrationServiceName } from '#/domain/deploy/migration-service.ts'
import { DEFAULT_MIGRATE_COMMAND } from '#/domain/deploy/target.ts'

import { pruneProjectBackups } from './prune-backups.ts'
import { resolveDeployContext } from './resolve-deploy-context.ts'

import type { PostgresServiceConfig } from '#/config/service-config.ts'
import type {
	CloudflareWorkersDeployableConfig,
	DeployableConfig,
} from '#/config/types.ts'
import type { MigrateInput } from '#/domain/deploy/target.ts'

/**
 * `migrate-remote` runs the migrate phase between `provision` and `deploy`, in
 * its own GH Actions job, so a failure halts the workflow BEFORE the app rotates
 * against an unmigrated schema. It dispatches on the declared database:
 *
 *   - `[services.postgres]` (Hetzner VPS): stage the rollout, then migrate in an
 *     ephemeral container inside the project's docker network.
 *   - `[services.d1]` (Cloudflare Workers): apply D1 migrations with
 *     `wrangler d1 migrations apply --remote` - no rollout to stage (no database
 *     to bring up) and no image (wrangler resolves the database + migrations
 *     from the generated config).
 *
 * The two databases never coexist (postgres is rejected on Workers and d1 on
 * Hetzner), so exactly one branch runs; a project declaring neither is a no-op.
 */
export async function migrateRemoteCommand(
	config: DeployableConfig,
): Promise<void> {
	const { postgres, d1 } = config.services
	if (postgres) {
		await migratePostgres(config, postgres)
		return
	}
	if (isCloudflareWorkersDeployableConfig(config) && d1) {
		await migrateD1(config)
		return
	}
	logger.info(
		`Skipping migrate-remote: no [services.postgres] or [services.d1] for "${config.project.name}"`,
	)
}

/**
 * Hetzner VPS path. Stages the rollout (env + compose files on disk, image
 * pulled, postgres up + healthy - on a fresh VPS the wal-g entrypoint rehydrates
 * from the latest base backup + archived WAL first, so migrate runs on the
 * recovered schema) then runs the migrate command in an ephemeral container.
 *
 * No pre-migrate snapshot is taken: continuous WAL archiving plus periodic base
 * backups already capture the pre-migration state for a wal-g PITR (operator-run,
 * a separate follow-up).
 */
async function migratePostgres(
	config: DeployableConfig,
	postgres: PostgresServiceConfig,
): Promise<void> {
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
		kind: 'container',
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
		await pruneProjectBackups(
			infraStorage,
			config.project.name,
			environment,
		)
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

/**
 * Cloudflare Workers path. Applies pending D1 migrations against the remote
 * database via the target, which drives `wrangler d1 migrations apply`. No
 * IMAGE_REFS (no Docker image) and no `prepareRollout` (no database to stage) -
 * the D1 migrate input carries only project + environment.
 */
async function migrateD1(
	config: CloudflareWorkersDeployableConfig,
): Promise<void> {
	const { target, environment } = await resolveDeployContext(config)

	const migrateResult = await target.runMigrate({
		kind: 'd1',
		projectName: config.project.name,
		environment,
	})
	logger.info(
		`Migration applied for "${config.project.name}" in ${migrateResult.durationMs}ms`,
	)

	writeSummary(
		buildMigrateSummary({
			projectName: config.project.name,
			environment,
			migrateDurationMs: migrateResult.durationMs,
			snapshotDurationMs: null,
		}),
	)
}
