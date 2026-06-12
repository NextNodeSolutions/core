import { deleteR2CustomDomain } from '#/adapters/cloudflare/r2/domains.ts'
import { writeSummary } from '#/adapters/github/output.ts'
import { wipePostgresBackups } from '#/adapters/r2/backup-store.ts'
import { getEnumEnv, getEnv, isEnvSet, requireEnv } from '#/cli/env.ts'
import { computeR2CustomDomainHostname } from '#/domain/cloudflare/r2/custom-domain.ts'
import { resolveDeployDomain } from '#/domain/deploy/domain.ts'
import { buildTeardownSummary } from '#/domain/deploy/teardown-summary.ts'
import {
	TEARDOWN_TARGETS,
	validateTeardownOptions,
} from '#/domain/deploy/teardown-target.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { postgresBackupBucketName } from '#/domain/services/postgres.ts'
import { computeR2BucketName } from '#/domain/services/r2.ts'
import { S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@nextnode-solutions/logger'

import { buildRuntimeTarget } from './build-runtime-target.ts'
import { loadInfraStorageForConfig } from './load-infra-storage.ts'

import type { DeployableConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { TeardownTarget } from '#/domain/deploy/teardown-target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const logger = createLogger()

// Either wipe the project's postgres backup bucket (irreversible) or log that
// it was preserved. Driven by the TEARDOWN_WIPE_BACKUPS opt-in.
async function reconcilePostgresBackups(
	projectName: string,
	infraStorage: InfraStorageRuntimeConfig,
	shouldWipeBackups: boolean,
): Promise<void> {
	const bucket = postgresBackupBucketName(projectName)
	if (!shouldWipeBackups) {
		logger.info(
			`Preserving backup bucket "${bucket}" (use --wipe-backups to remove).`,
		)
		return
	}
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
}

/**
 * Detach the public custom domain from every `cdn`-enabled bucket so no
 * orphaned Cloudflare binding (and its auto-created CNAME) survives the
 * teardown. Only runs on `project` scope - `vps` is a server-level
 * operation that leaves project R2 data in place. Reversible: a later
 * provision re-attaches the domain.
 */
async function teardownR2CustomDomains(
	config: DeployableConfig,
	environment: AppEnvironment,
	infraStorage: InfraStorageRuntimeConfig | null,
	teardownTarget: TeardownTarget,
): Promise<void> {
	if (teardownTarget !== 'project') return
	if (infraStorage === null) return
	const { domain } = config.project
	if (domain === undefined) return
	const cdnBuckets = (config.services.r2?.buckets ?? []).filter(
		bucket => bucket.cdn,
	)
	if (cdnBuckets.length === 0) return

	const cfToken = requireEnv('CLOUDFLARE_API_TOKEN')
	const { accountId } = infraStorage
	// Resolve the deploy domain ONCE - the same single resolution the provision
	// path applies via `resolveServices` - so the hostname detached here matches
	// the one attached at provision (in development both gain the `dev.` prefix).
	const resolvedDomain = resolveDeployDomain(domain, environment)
	await Promise.all(
		cdnBuckets.map(async bucket => {
			const bucketName = computeR2BucketName(
				config.project.name,
				environment,
				bucket.name,
			)
			const hostname = computeR2CustomDomainHostname(
				bucket.name,
				resolvedDomain,
			)
			await deleteR2CustomDomain(cfToken, accountId, bucketName, hostname)
			logger.info(
				`Detached R2 custom domain "${hostname}" from bucket "${bucketName}"`,
			)
		}),
	)
}

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
	const shouldWipeVolumes = isEnvSet('TEARDOWN_WITH_VOLUMES')
	const wipeBackups = isEnvSet('TEARDOWN_WIPE_BACKUPS')
	validateTeardownOptions(
		config.project.type,
		teardownTarget,
		shouldWipeVolumes,
	)
	const infraStorage = await loadInfraStorageForConfig(config)
	const target = buildRuntimeTarget(config, environment, infraStorage)

	// Audit line - emitted BEFORE any destructive call so CI log readers can
	// reconstruct the exact scope of the teardown (project, env, target type,
	// domain) even if a later step fails mid-flight.
	logger.info(
		`Teardown starting: project="${config.project.name}" env="${environment}" target="${target.name}" scope="${teardownTarget}" shouldWipeVolumes=${String(shouldWipeVolumes)} wipeBackups=${String(wipeBackups)} domain="${config.project.domain ?? '(none)'}"`,
	)

	const teardownResult = await target.teardown(
		config.project.name,
		config.project.domain,
		teardownTarget,
		shouldWipeVolumes,
	)

	if (config.services.postgres !== undefined && infraStorage !== null) {
		await reconcilePostgresBackups(
			config.project.name,
			infraStorage,
			wipeBackups,
		)
	}

	await teardownR2CustomDomains(
		config,
		environment,
		infraStorage,
		teardownTarget,
	)

	writeSummary(
		buildTeardownSummary(teardownResult, config.project.name, target.name),
	)
}
