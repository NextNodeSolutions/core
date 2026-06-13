import { writeSummary } from '#/adapters/github/output.ts'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { isHetznerDeployableConfig } from '#/config/types.ts'
import { databaseHasData } from '#/domain/deploy/auto-restore.ts'
import { selectServiceImage } from '#/domain/deploy/image-ref.ts'
import { buildMigrateSummary } from '#/domain/deploy/migrate-summary.ts'
import { resolveMigrationServiceName } from '#/domain/deploy/migration-service.ts'
import { DEFAULT_MIGRATE_COMMAND } from '#/domain/deploy/target.ts'

import { listProjectBackupSnapshots } from './list-backups.ts'
import { resolveDeployContext } from './resolve-deploy-context.ts'

import type { DeployableConfig, PostgresServiceConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { AutoRestoreResult } from '#/domain/deploy/auto-restore.ts'
import type { DeployTarget, MigrateInput } from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

// Rehydrate a freshly-provisioned embedded database from the latest R2 dump
// before the pre-migrate snapshot + migration. Lists the project's backup
// bucket here (cli layer) and hands the count to the target, which probes the
// live DB and restores ONLY when it is empty AND a dump exists. A no-op skip
// on a populated DB (redeploy) or a backup-less first deploy.
async function runAutoRestore(
	target: DeployTarget,
	infraStorage: InfraStorageRuntimeConfig | null,
	projectName: string,
	environment: AppEnvironment,
): Promise<AutoRestoreResult> {
	if (infraStorage === null) {
		throw new Error(
			`migrate-remote: embedded postgres for "${projectName}" needs R2 (infra storage) to check for prior backups, but none was resolved - this is a wiring bug for a hetzner-vps target.`,
		)
	}

	const snapshots = await listProjectBackupSnapshots(
		infraStorage,
		projectName,
	)
	const outcome = await target.runAutoRestore({
		projectName,
		environment,
		snapshotCount: snapshots.length,
	})
	logAutoRestoreOutcome(projectName, environment, outcome, snapshots.length)
	return outcome
}

function logAutoRestoreOutcome(
	projectName: string,
	environment: AppEnvironment,
	outcome: AutoRestoreResult,
	snapshotCount: number,
): void {
	const subject = `"${projectName}" (${environment})`
	if (outcome.action === 'restore') {
		logger.info(
			`Auto-restored ${subject} from the latest of ${String(snapshotCount)} R2 dump(s): ${String(outcome.tableCountAfter)} user table(s) present in ${String(outcome.durationMs)}ms`,
		)
		return
	}
	if (outcome.action === 'skip-db-populated') {
		logger.info(
			`Skipping auto-restore for ${subject}: database already holds ${String(outcome.tableCountBefore)} user table(s) - existing data left untouched`,
		)
		return
	}
	logger.info(
		`Skipping auto-restore for ${subject}: fresh database and no prior R2 backup - starting empty`,
	)
}

interface PreMigrateStepsInput {
	readonly target: DeployTarget
	readonly postgres: PostgresServiceConfig
	readonly infraStorage: InfraStorageRuntimeConfig | null
	readonly projectName: string
	readonly environment: AppEnvironment
}

// Embedded postgres pre-migrate sequence: rehydrate a fresh DB from the latest
// R2 dump, then take the rollback snapshot - but ONLY when the DB ends up with
// data. An empty DB (genuine first deploy, no prior dump) has nothing to roll
// back to, and snapshotting it would upload an empty dump a retry could wrongly
// restore (see databaseHasData). Returns the snapshot duration for the summary;
// `null` for external postgres or an empty DB (no snapshot taken).
async function runEmbeddedPreMigrateSteps(
	step: PreMigrateStepsInput,
): Promise<number | null> {
	if (step.postgres.mode !== 'embedded') return null
	const outcome = await runAutoRestore(
		step.target,
		step.infraStorage,
		step.projectName,
		step.environment,
	)
	if (!databaseHasData(outcome)) return null
	return runPreMigrateSnapshot(
		step.target,
		step.projectName,
		step.environment,
	)
}

// Take an embedded-postgres pre-migrate snapshot so a failed migration can be
// rolled back. Returns the snapshot duration for the summary.
async function runPreMigrateSnapshot(
	target: DeployTarget,
	projectName: string,
	environment: AppEnvironment,
): Promise<number> {
	const snapshot = await target.runPreMigrateSnapshot({
		projectName,
		environment,
	})
	logger.info(
		`Pre-migrate snapshot for "${projectName}" completed in ${String(snapshot.durationMs)}ms`,
	)
	return snapshot.durationMs
}

/**
 * `migrate-remote` orchestrates Path A's migrate phase. It runs in its
 * own GH Actions job between `provision` and `deploy`, so a failure
 * here halts the workflow BEFORE the app rotates against an
 * unmigrated schema.
 *
 * Steps:
 *   1. Stage the rollout on the target - env file, compose file,
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
 * snapshot - it stays in R2 for `infrastructure restore`, which picks
 * the right dump by timestamp (most-recent ≤ deploy time). Skipped
 * (early-exit) when the project does not declare `[services.postgres]`.
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

	// Embedded only: auto-restore a fresh DB from the latest R2 dump, then
	// snapshot - both BEFORE migrate so forward-only migrations apply on top
	// of the (possibly rehydrated) schema and the rollback point captures it.
	const snapshotDurationMs = await runEmbeddedPreMigrateSteps({
		target,
		postgres,
		infraStorage,
		projectName: config.project.name,
		environment,
	})

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

	writeSummary(
		buildMigrateSummary({
			projectName: config.project.name,
			environment,
			migrateDurationMs: migrateResult.durationMs,
			snapshotDurationMs,
		}),
	)
}
