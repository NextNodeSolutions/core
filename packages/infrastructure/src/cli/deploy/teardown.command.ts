import { writeSummary } from '#/adapters/github/output.ts'
import { wipePostgresBackups } from '#/adapters/r2/backup-store.ts'
import { getEnumEnv, getEnv, isEnvSet } from '#/cli/env.ts'
import type { DeployableConfig } from '#/config/types.ts'
import { buildTeardownSummary } from '#/domain/deploy/teardown-summary.ts'
import {
	TEARDOWN_TARGETS,
	validateTeardownOptions,
} from '#/domain/deploy/teardown-target.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { postgresBackupBucketName } from '#/domain/services/postgres.ts'
import { S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@nextnode-solutions/logger'

import { buildRuntimeTarget } from './build-runtime-target.ts'
import { loadInfraStorageForConfig } from './load-infra-storage.ts'

const logger = createLogger()

export async function teardownCommand(config: DeployableConfig): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const teardownTarget = getEnumEnv(
		'TEARDOWN_TARGET',
		TEARDOWN_TARGETS,
		'project',
	)
	const withVolumes = isEnvSet('TEARDOWN_WITH_VOLUMES')
	const wipeBackups = isEnvSet('TEARDOWN_WIPE_BACKUPS')
	validateTeardownOptions(config.project.type, teardownTarget, withVolumes)
	const infraStorage = await loadInfraStorageForConfig(config)
	const target = buildRuntimeTarget(config, environment, infraStorage)

	// Audit line — emitted BEFORE any destructive call so CI log readers can
	// reconstruct the exact scope of the teardown (project, env, target type,
	// domain) even if a later step fails mid-flight.
	logger.info(
		`Teardown starting: project="${config.project.name}" env="${environment}" target="${target.name}" scope="${teardownTarget}" withVolumes=${String(withVolumes)} wipeBackups=${String(wipeBackups)} domain="${config.project.domain ?? '(none)'}"`,
	)

	const result = await target.teardown(
		config.project.name,
		config.project.domain,
		teardownTarget,
		withVolumes,
	)

	if (config.services.postgres !== undefined && infraStorage !== null) {
		const bucket = postgresBackupBucketName(config.project.name)
		if (wipeBackups) {
			logger.info(`Wiping backup bucket "${bucket}" (irreversible)...`)
			const s3 = new S3Client({
				region: 'auto',
				endpoint: infraStorage.endpoint,
				credentials: {
					accessKeyId: infraStorage.accessKeyId,
					secretAccessKey: infraStorage.secretAccessKey,
				},
			})
			await wipePostgresBackups(s3, bucket)
		} else {
			logger.info(
				`Preserving backup bucket "${bucket}" (use --wipe-backups to remove).`,
			)
		}
	}

	writeSummary(buildTeardownSummary(result, config.project.name, target.name))
}
