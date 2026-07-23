import { deleteR2CustomDomain } from '#/adapters/cloudflare/r2/domains.ts'
import { writeSummary } from '#/adapters/github/output.ts'
import { wipePostgresBackups } from '#/adapters/r2/backup-store.ts'
import { getEnumEnv, getEnv, isEnvSet, requireEnv } from '#/cli/env.ts'
import { isCloudflareWorkersDeployableConfig } from '#/config/types.ts'
import { computeR2CustomDomainHostname } from '#/domain/cloudflare/r2/custom-domain.ts'
import { assertWipeDataAllowed } from '#/domain/cloudflare/workers/teardown.ts'
import { resolveDeployDomain } from '#/domain/deploy/domain.ts'
import { buildTeardownSummary } from '#/domain/deploy/teardown-summary.ts'
import {
	TEARDOWN_TARGETS,
	validateTeardownOptions,
} from '#/domain/deploy/teardown-target.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { postgresWalgBucketName } from '#/domain/services/postgres-walg.ts'
import { postgresBackupBucketName } from '#/domain/services/postgres.ts'
import { computeR2BucketName } from '#/domain/services/r2.ts'
import { S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@nextnode-solutions/logger'

import { buildRuntimeTarget } from './build-runtime-target.ts'
import { loadInfraStorageForConfig } from './load-infra-storage.ts'

import type { DeployableConfig, DeployTargetType } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { DeployTarget } from '#/domain/deploy/target.ts'
import type { TeardownTarget } from '#/domain/deploy/teardown-target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const logger = createLogger()

interface FinalBackupGate {
	readonly target: DeployTarget
	readonly config: DeployableConfig
	readonly environment: AppEnvironment
	readonly wipeBackups: boolean
	readonly skipFinalBackup: boolean
}

/**
 * Capture a final wal-g base backup of the embedded database to R2 BEFORE the
 * destructive teardown runs, while postgres is still alive. The next
 * provisioning of this project (on a fresh VPS) restores this backup + replays
 * archived WAL, so a planned teardown + redeploy loses ZERO data (vs up to the
 * archive_timeout window, ~180s, back to the last archived WAL segment).
 *
 * No-op unless the project runs embedded postgres; skipped when we are wiping
 * the backups anyway (`--wipe-backups`) or the operator opted out
 * (`TEARDOWN_SKIP_FINAL_BACKUP`). Fail-loud otherwise: if the backup fails
 * (e.g. the VPS is already unreachable), we ABORT the teardown rather than
 * destroy data we could not capture. The override is for a genuinely dead VPS
 * - the continuously-archived WAL still covers up to the last archived segment.
 */
async function maybeCaptureFinalBackup(gate: FinalBackupGate): Promise<void> {
	if (gate.config.services.postgres?.mode !== 'embedded') return
	if (gate.wipeBackups || gate.skipFinalBackup) return

	const projectName = gate.config.project.name
	logger.info(
		`Capturing a final backup of "${projectName}" (${gate.environment}) before teardown...`,
	)
	try {
		const { durationMs } = await gate.target.runFinalBackup({
			projectName,
			environment: gate.environment,
		})
		logger.info(
			`Final backup of "${projectName}" uploaded to R2 in ${String(durationMs)}ms - the next VPS will auto-restore it.`,
		)
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		throw new Error(
			`Final pre-teardown backup of "${projectName}" FAILED (${reason}). Teardown ABORTED so no un-captured data is destroyed. If the VPS is already unreachable and you accept losing writes since the last archived WAL segment (~180s), re-run with TEARDOWN_SKIP_FINAL_BACKUP=1.`,
			{ cause: error },
		)
	}
}

// Either wipe BOTH of the project's postgres backup buckets (the wal-g
// `<project>-backups` and the pg_dump `<project>-backups-dump`, irreversible) or
// log that they were preserved. Driven by the TEARDOWN_WIPE_BACKUPS opt-in. Both
// schemes are wiped so `--wipe-backups` actually purges every backup - the wal-g
// bucket holds the live base backups + WAL, the dump bucket the logical GFS
// dumps; leaving either behind would strand real backups.
async function reconcilePostgresBackups(
	projectName: string,
	infraStorage: InfraStorageRuntimeConfig,
	shouldWipeBackups: boolean,
): Promise<void> {
	const buckets = [
		postgresWalgBucketName(projectName),
		postgresBackupBucketName(projectName),
	]
	if (!shouldWipeBackups) {
		logger.info(
			`Preserving backup buckets ${buckets.map(b => `"${b}"`).join(', ')} (use --wipe-backups to remove).`,
		)
		return
	}
	const s3 = new S3Client({
		region: 'auto',
		endpoint: infraStorage.endpoint,
		credentials: {
			accessKeyId: infraStorage.accessKeyId,
			secretAccessKey: infraStorage.secretAccessKey,
		},
	})
	await Promise.all(
		buckets.map(bucket => {
			logger.info(`Wiping backup bucket "${bucket}" (irreversible)...`)
			return wipePostgresBackups(s3, bucket)
		}),
	)
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
	// A cloudflare-workers project declares its R2 custom domains as
	// `cloudflare_r2_custom_domain` Terraform resources; `terraform destroy` in
	// the workers target removes them. The CF-API detach path here is only for
	// the R2 *service* used by Pages/Hetzner projects.
	if (isCloudflareWorkersDeployableConfig(config)) return
	if (teardownTarget !== 'project') return
	if (infraStorage === null) return
	const { domain } = config.project
	if (typeof domain === 'undefined') return
	const cdnBuckets = (config.services.r2?.buckets ?? []).filter(
		bucket => bucket.cdn,
	)
	if (cdnBuckets.length === 0) return

	const cfToken = requireEnv('CLOUDFLARE_API_TOKEN')
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
			await deleteR2CustomDomain(
				cfToken,
				infraStorage.accountId,
				bucketName,
				hostname,
			)
			logger.info(
				`Detached R2 custom domain "${hostname}" from bucket "${bucketName}"`,
			)
		}),
	)
}

interface TeardownOptions {
	readonly teardownTarget: TeardownTarget
	readonly shouldWipeVolumes: boolean
	readonly wipeBackups: boolean
	readonly skipFinalBackup: boolean
	readonly wipeData: boolean
}

// Read + validate the teardown opt-ins from the environment. Extracted to keep
// teardownCommand a thin orchestrator.
function readTeardownOptions(deployTarget: DeployTargetType): TeardownOptions {
	const teardownTarget = getEnumEnv(
		'TEARDOWN_TARGET',
		TEARDOWN_TARGETS,
		'project',
	)
	const shouldWipeVolumes = isEnvSet('TEARDOWN_WITH_VOLUMES')
	const wipeBackups = isEnvSet('TEARDOWN_WIPE_BACKUPS')
	const skipFinalBackup = isEnvSet('TEARDOWN_SKIP_FINAL_BACKUP')
	const wipeData = isEnvSet('TEARDOWN_WIPE_DATA')
	validateTeardownOptions(deployTarget, teardownTarget, shouldWipeVolumes)
	return {
		teardownTarget,
		shouldWipeVolumes,
		wipeBackups,
		skipFinalBackup,
		wipeData,
	}
}

export async function teardownCommand(config: DeployableConfig): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const {
		teardownTarget,
		shouldWipeVolumes,
		wipeBackups,
		skipFinalBackup,
		wipeData,
	} = readTeardownOptions(config.deploy.target)
	const infraStorage = await loadInfraStorageForConfig(config)
	const target = buildRuntimeTarget(config, environment, infraStorage)

	// Refuse to destroy D1/R2 data on a cloudflare-workers project unless the
	// operator explicitly opted in - asserted BEFORE any destructive step.
	if (isCloudflareWorkersDeployableConfig(config)) {
		assertWipeDataAllowed(config.project.name, config.services, wipeData)
	}

	// Audit line - emitted BEFORE any destructive call so CI log readers can
	// reconstruct the exact scope of the teardown (project, env, target type,
	// domain) even if a later step fails mid-flight.
	logger.info(
		`Teardown starting: project="${config.project.name}" env="${environment}" target="${target.name}" scope="${teardownTarget}" shouldWipeVolumes=${String(shouldWipeVolumes)} wipeBackups=${String(wipeBackups)} skipFinalBackup=${String(skipFinalBackup)} wipeData=${String(wipeData)} domain="${config.project.domain ?? '(none)'}"`,
	)

	// Final backup BEFORE the destructive teardown. Aborts the teardown on
	// failure - see maybeCaptureFinalBackup.
	await maybeCaptureFinalBackup({
		target,
		config,
		environment,
		wipeBackups,
		skipFinalBackup,
	})

	const teardownResult = await target.teardown(
		config.project.name,
		config.project.domain,
		teardownTarget,
		shouldWipeVolumes,
	)

	if (config.services.postgres && infraStorage !== null) {
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
