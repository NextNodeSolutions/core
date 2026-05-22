import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runPgRestore } from '#/adapters/postgres/restore-runner.ts'
import {
	downloadPostgresBackup,
	listPostgresBackupSnapshots,
} from '#/adapters/r2/backup-store.ts'
import { requireEnv } from '#/cli/env.ts'
import { loadR2Runtime } from '#/cli/r2/load-runtime.ts'
import {
	ensurePostgresRestoreConfirmed,
	parsePostgresRestoreArgs,
	postgresBackupBucketName,
	selectPostgresBackupForRestore,
} from '#/domain/services/postgres.ts'
import { S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

const ARGV_FLAGS_START_INDEX = 3

/**
 * Operator-invoked restore: fetch the closest dump ≤ `--at` from the
 * project's R2 backup bucket and replay it into the target database.
 *
 * Standalone command (no `PIPELINE_CONFIG_FILE`) — the operator passes
 * `--project`, `--at`, and `--yes` on argv, plus `CLOUDFLARE_API_TOKEN`,
 * `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `DATABASE_URL` in env.
 *
 * Safety: refuses without `--yes`. pg_restore is run with `--clean
 * --if-exists`, which drops existing objects before recreating them —
 * unrecoverable on a misfire, so the confirmation flag is mandatory.
 *
 * On success the temp dir holding the downloaded dump is removed; on
 * failure it is also removed (a half-downloaded dump on disk is not
 * useful). The Linear task description says "test covers backup
 * selection logic and the safety gate" — both live in the domain so
 * the cli command stays a thin wire-up.
 */
export async function restoreCommand(): Promise<void> {
	const args = parsePostgresRestoreArgs(
		process.argv.slice(ARGV_FLAGS_START_INDEX),
	)
	ensurePostgresRestoreConfirmed(args)

	const databaseUrl = requireEnv('DATABASE_URL')
	const cfToken = requireEnv('CLOUDFLARE_API_TOKEN')
	const infraStorage = await loadR2Runtime(cfToken)
	const bucket = postgresBackupBucketName(args.project)

	const s3 = new S3Client({
		region: 'auto',
		endpoint: infraStorage.endpoint,
		credentials: {
			accessKeyId: infraStorage.accessKeyId,
			secretAccessKey: infraStorage.secretAccessKey,
		},
	})

	logger.info(`Listing postgres backups in "${bucket}"...`)
	const snapshots = await listPostgresBackupSnapshots(s3, bucket)
	const chosen = selectPostgresBackupForRestore(snapshots, args.at)
	if (chosen === null) {
		throw new Error(
			`restore: no backup found in "${bucket}" on or before ${args.at.toISOString()} (${String(snapshots.length)} snapshots scanned).`,
		)
	}
	logger.info(
		`Selected ${chosen.key} (${chosen.timestamp.toISOString()}) — closest dump ≤ ${args.at.toISOString()}.`,
	)

	const workDir = await mkdtemp(join(tmpdir(), 'pg-restore-'))
	const dumpPath = join(workDir, 'dump')
	try {
		logger.info(`Downloading ${chosen.key} to ${dumpPath}...`)
		await downloadPostgresBackup(s3, bucket, chosen.key, dumpPath)
		logger.info(`Running pg_restore against target database...`)
		runPgRestore({ databaseUrl, dumpPath })
		logger.info(`Restore complete for project "${args.project}".`)
	} finally {
		await rm(workDir, { recursive: true, force: true })
	}
}
