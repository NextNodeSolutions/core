import { listPostgresBackupSnapshots } from '#/adapters/r2/backup-store.ts'
import { postgresBackupBucketName } from '#/domain/services/postgres.ts'
import { NoSuchBucket, S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@nextnode-solutions/logger'

import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { PostgresBackupSnapshot } from '#/domain/services/postgres.ts'

const logger = createLogger()

/**
 * List the postgres dump snapshots in a project's deterministic R2 backup
 * bucket (`nn-backups-<project>`). Lives in the cli layer because it wires
 * the S3 adapter to a project name - the strict layering bans the hetzner
 * adapter from calling the r2 adapter directly, so the auto-restore
 * decision's "does a prior dump exist?" input is resolved here and passed
 * down to `target.runAutoRestore`.
 *
 * The bucket is created (idempotently) during provision, which runs before
 * migrate, so it normally exists by the time this is called. A missing
 * bucket is treated as "no backups yet" - the same outcome as an empty
 * bucket - but logged as a warning rather than swallowed silently, because
 * an absent bucket at migrate time is unexpected (it hints provision did
 * not create it).
 */
export async function listProjectBackupSnapshots(
	infraStorage: InfraStorageRuntimeConfig,
	projectName: string,
): Promise<PostgresBackupSnapshot[]> {
	const s3 = new S3Client({
		region: 'auto',
		endpoint: infraStorage.endpoint,
		credentials: {
			accessKeyId: infraStorage.accessKeyId,
			secretAccessKey: infraStorage.secretAccessKey,
		},
	})
	const bucket = postgresBackupBucketName(projectName)

	try {
		return await listPostgresBackupSnapshots(s3, bucket)
	} catch (error) {
		// Only an absent bucket is benign ("no prior backups"); every other
		// failure (AccessDenied, throttling, network) must propagate and halt
		// the deploy rather than be misread as "no backups -> start empty".
		// `instanceof` (not an error.name string match) mirrors the codebase's
		// S3 error handling in adapters/r2/client.ts.
		if (error instanceof NoSuchBucket) {
			logger.warn(
				`Backup bucket "${bucket}" does not exist yet - treating "${projectName}" as having no prior backups (provision normally creates it).`,
			)
			return []
		}
		throw error
	}
}
