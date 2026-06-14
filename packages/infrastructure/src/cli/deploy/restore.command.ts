import { executeRestoreAt } from '#/adapters/hetzner/restore.ts'
import { createSshSession } from '#/adapters/hetzner/ssh/session.ts'
import {
	STATE_KEY_PREFIX,
	readState,
	vpsNameFromStateKey,
} from '#/adapters/hetzner/state/read-write.ts'
import { listPostgresBackupSnapshots } from '#/adapters/r2/backup-store.ts'
import { R2Client } from '#/adapters/r2/client.ts'
import { requireB64Env, requireEnv } from '#/cli/env.ts'
import { loadR2Runtime } from '#/cli/r2/load-runtime.ts'
import {
	ensurePostgresRestoreConfirmed,
	parsePostgresRestoreArgs,
	postgresBackupBucketName,
	selectPostgresBackupForRestore,
} from '#/domain/services/postgres.ts'
import { S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@nextnode-solutions/logger'

import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const logger = createLogger()

const ARGV_FLAGS_START_INDEX = 3
// Length of `YYYY-MM-DDTHH:MM:SS` - the exact key segment the sidecar wrote and
// the argument `restore.sh` expects (Date.toISOString without `.000Z`).
const ISO_SECONDS_LENGTH = 19
const DEPLOY_SSH_USERNAME = 'deploy'
// pg_dump backups are written only in production (the sidecar is production-
// only, mirroring wal-g), so the operator restore always targets the prod silo.
const RESTORE_ENVIRONMENT: AppEnvironment = 'production'

interface ProjectVpsLocation {
	readonly vpsName: string
	readonly tailnetIp: string
	readonly sshHostKeyFingerprint: string | undefined
}

/**
 * Find the provisioned VPS hosting `projectName` by scanning the `hetzner/`
 * state files for one whose `hostPorts` map carries the project. Returns its
 * tailnet IP + persisted host-key fingerprint so the caller can open a pinned
 * SSH session. `null` when no deployable VPS hosts the project (never deployed,
 * or still phase=created with no tailnet IP).
 */
async function resolveProjectVps(
	stateR2: R2Client,
	projectName: string,
): Promise<ProjectVpsLocation | null> {
	const vpsNames = (await stateR2.listKeys(STATE_KEY_PREFIX))
		.map(vpsNameFromStateKey)
		.filter((name): name is string => name !== null)
	const entries = await Promise.all(
		vpsNames.map(async name => ({
			name,
			read: await readState(stateR2, name),
		})),
	)
	for (const { name, read } of entries) {
		if (read === null || read.state.phase === 'created') continue
		if (!Object.hasOwn(read.state.hostPorts, projectName)) continue
		return {
			vpsName: name,
			tailnetIp: read.state.tailnetIp,
			sshHostKeyFingerprint: read.state.sshHostKeyFingerprint,
		}
	}
	return null
}

/**
 * Pick the closest pg_dump <= `at` from the project's R2 dump bucket and return
 * the exact timestamp segment `restore.sh` expects (`%Y-%m-%dT%H:%M:%S`). This
 * runs CI-side and is read-only - the destructive replay happens in the sidecar.
 * Throws when no dump qualifies.
 */
async function selectDumpTimestamp(
	infraStorage: InfraStorageRuntimeConfig,
	project: string,
	at: Date,
): Promise<string> {
	const bucket = postgresBackupBucketName(project)
	const s3 = new S3Client({
		region: 'auto',
		endpoint: infraStorage.endpoint,
		credentials: {
			accessKeyId: infraStorage.accessKeyId,
			secretAccessKey: infraStorage.secretAccessKey,
		},
	})
	logger.info(`Listing postgres dumps in "${bucket}"...`)
	const snapshots = await listPostgresBackupSnapshots(s3, bucket)
	const chosen = selectPostgresBackupForRestore(snapshots, at)
	if (chosen === null) {
		throw new Error(
			`restore: no backup found in "${bucket}" on or before ${at.toISOString()} (${String(snapshots.length)} snapshots scanned).`,
		)
	}
	const timestamp = chosen.timestamp
		.toISOString()
		.slice(0, ISO_SECONDS_LENGTH)
	logger.info(
		`Selected ${chosen.key} (${timestamp}) - closest dump <= ${at.toISOString()}.`,
	)
	return timestamp
}

/**
 * Operator-invoked restore: pick the closest pg_dump <= `--at` from the
 * project's R2 dump bucket and replay it INTO the embedded database on the VPS,
 * by exec-ing `restore.sh <timestamp>` inside the running `postgres-backup`
 * sidecar over SSH. The sidecar already holds the R2 creds + a connection to
 * the postgres service, so the restore runs where the database actually lives -
 * the embedded postgres binds no host port, so a CI-side pg_restore against
 * DATABASE_URL could never reach it.
 *
 * Standalone command (no `PIPELINE_CONFIG_FILE`): the operator passes
 * `--project`, `--at`, `--yes` on argv, plus `CLOUDFLARE_API_TOKEN`, `R2_*`,
 * and `DEPLOY_SSH_PRIVATE_KEY_B64` in env, and runs from a tailnet-connected
 * context (the VPS is reachable only over Tailscale).
 *
 * Safety: refuses without `--yes` (`restore.sh` runs `pg_restore --clean`,
 * which drops objects before recreating them).
 */
export async function restoreCommand(): Promise<void> {
	const args = parsePostgresRestoreArgs(
		process.argv.slice(ARGV_FLAGS_START_INDEX),
	)
	ensurePostgresRestoreConfirmed(args)

	const cfToken = requireEnv('CLOUDFLARE_API_TOKEN')
	const deployPrivateKey = requireB64Env('DEPLOY_SSH_PRIVATE_KEY_B64')
	const infraStorage = await loadR2Runtime(cfToken)

	const timestamp = await selectDumpTimestamp(
		infraStorage,
		args.project,
		args.at,
	)

	const stateR2 = new R2Client({
		endpoint: infraStorage.endpoint,
		accessKeyId: infraStorage.accessKeyId,
		secretAccessKey: infraStorage.secretAccessKey,
		bucket: infraStorage.stateBucket,
	})
	const location = await resolveProjectVps(stateR2, args.project)
	if (location === null) {
		throw new Error(
			`restore: no provisioned VPS hosts "${args.project}" (scanned the hetzner/ state files). Has it been deployed?`,
		)
	}

	logger.info(
		`Restoring on VPS "${location.vpsName}" (${RESTORE_ENVIRONMENT}) via the backup sidecar...`,
	)
	const session = await createSshSession({
		host: location.tailnetIp,
		username: DEPLOY_SSH_USERNAME,
		privateKey: deployPrivateKey,
		expectedHostKeyFingerprint: location.sshHostKeyFingerprint,
	})
	try {
		await executeRestoreAt(
			session,
			{ projectName: args.project, environment: RESTORE_ENVIRONMENT },
			timestamp,
		)
		logger.info(`Restore complete for project "${args.project}".`)
	} finally {
		session.close()
	}
}
