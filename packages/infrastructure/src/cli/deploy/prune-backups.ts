import { writeSummary } from '#/adapters/github/output.ts'
import { prunePostgresBackups } from '#/adapters/r2/backup-store.ts'
import { R2Client } from '#/adapters/r2/client.ts'
import { requireEnv } from '#/cli/env.ts'
import { loadR2Runtime } from '#/cli/r2/load-runtime.ts'
import { tryLoadPostgresBackupCreds } from '#/cli/services/postgres/postgres-backup-creds.ts'
import { buildPruneBackupsSummary } from '#/domain/deploy/prune-backups-summary.ts'
import {
	POSTGRES_BACKUP_STATE_PREFIX,
	parsePostgresBackupStateKey,
} from '#/domain/services/postgres-backup.ts'
import { postgresBackupBucketName } from '#/domain/services/postgres.ts'
import { NoSuchBucket, S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@nextnode-solutions/logger'

import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { ProjectPruneOutcome } from '#/domain/deploy/prune-backups-summary.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const logger = createLogger()

// The "scanned nothing, deleted nothing" outcome - reused for every benign
// skip (no creds, or a wiped bucket).
const nothingToPrune = (projectName: string): ProjectPruneOutcome => ({
	project: projectName,
	scanned: 0,
	pruned: 0,
	bucketMissing: true,
})

// Run the GFS prune against a resolved bucket, classifying a wiped bucket
// (`NoSuchBucket`) as benign while letting every other failure propagate so a
// broken prune is never mistaken for a clean one.
async function prunePostgresBucket(
	s3: S3Client,
	bucket: string,
	projectName: string,
): Promise<ProjectPruneOutcome> {
	try {
		const { scanned, pruned } = await prunePostgresBackups(s3, bucket)
		logger.info(
			`Pruned ${String(pruned)}/${String(scanned)} pg_dump backup(s) for "${projectName}" (${bucket}).`,
		)
		return { project: projectName, scanned, pruned, bucketMissing: false }
	} catch (error) {
		if (error instanceof NoSuchBucket) {
			logger.info(
				`No pg_dump backup bucket "${bucket}" for "${projectName}" - skipping (creds exist but the bucket was wiped).`,
			)
			return nothingToPrune(projectName)
		}
		throw error
	}
}

/**
 * Apply the GFS retention policy to ONE project's pg_dump backup bucket
 * (`<project>-backups-dump`). Reusable from both the on-deploy hook
 * (`migrate-remote`) and the daily cron (`pruneBackupsCommand`).
 *
 * The dump bucket is reachable ONLY with the per-project backup token (scoped
 * to `<project>-backups` + `<project>-backups-dump`), the same token the backup
 * sidecars and `restore` use - NOT the infra state token (state + certs only),
 * which would return AccessDenied. A project with no persisted backup creds is
 * benign (a non-postgres app, or one that never provisioned backups): it is
 * reported as `bucketMissing`. A `NoSuchBucket` (creds exist but the bucket was
 * wiped) is likewise benign; every other failure propagates so a broken prune
 * is never mistaken for a clean one.
 */
export async function pruneProjectBackups(
	infraStorage: InfraStorageRuntimeConfig,
	projectName: string,
	environment: AppEnvironment,
): Promise<ProjectPruneOutcome> {
	const backupCreds = await tryLoadPostgresBackupCreds({
		infraStorage,
		projectName,
		environment,
	})
	if (backupCreds === null) {
		logger.info(
			`No postgres backup credentials for "${projectName}" (${environment}) - skipping (not a postgres project, or never provisioned).`,
		)
		return nothingToPrune(projectName)
	}

	const s3 = new S3Client({
		region: 'auto',
		endpoint: backupCreds.endpoint,
		credentials: {
			accessKeyId: backupCreds.accessKeyId,
			secretAccessKey: backupCreds.secretAccessKey,
		},
	})
	return prunePostgresBucket(
		s3,
		postgresBackupBucketName(projectName),
		projectName,
	)
}

/**
 * Standalone cron command: prune the pg_dump backups of EVERY project in the
 * fleet under the GFS policy. Enumerates targets from the persisted backup-creds
 * state objects (`services/postgres-backup/<project>/<environment>.json`) - the
 * authoritative list of provisioned postgres backups, each carrying both the
 * project and the environment its dedicated token is scoped to. wal-g manages
 * its own bucket's retention, so only the `-dump` buckets are touched here.
 */
export async function pruneBackupsCommand(): Promise<void> {
	const cfToken = requireEnv('CLOUDFLARE_API_TOKEN')
	const infraStorage = await loadR2Runtime(cfToken)
	const stateR2 = new R2Client({
		endpoint: infraStorage.endpoint,
		accessKeyId: infraStorage.accessKeyId,
		secretAccessKey: infraStorage.secretAccessKey,
		bucket: infraStorage.stateBucket,
	})

	const stateKeys = await stateR2.listKeys(POSTGRES_BACKUP_STATE_PREFIX)
	const targets = stateKeys
		.map(parsePostgresBackupStateKey)
		.filter(
			(target): target is NonNullable<typeof target> => target !== null,
		)
	logger.info(
		`Considering ${String(targets.length)} provisioned postgres backup(s) for GFS prune.`,
	)

	const outcomes = await Promise.all(
		targets.map(target =>
			pruneProjectBackups(
				infraStorage,
				target.projectName,
				target.environment,
			),
		),
	)

	writeSummary(buildPruneBackupsSummary(outcomes))
}
