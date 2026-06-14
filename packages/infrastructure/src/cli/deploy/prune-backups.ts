import { writeSummary } from '#/adapters/github/output.ts'
import {
	STATE_KEY_PREFIX,
	readState,
	vpsNameFromStateKey,
} from '#/adapters/hetzner/state/read-write.ts'
import { prunePostgresBackups } from '#/adapters/r2/backup-store.ts'
import { R2Client } from '#/adapters/r2/client.ts'
import { requireEnv } from '#/cli/env.ts'
import { loadR2Runtime } from '#/cli/r2/load-runtime.ts'
import { buildPruneBackupsSummary } from '#/domain/deploy/prune-backups-summary.ts'
import { postgresBackupBucketName } from '#/domain/services/postgres.ts'
import { NoSuchBucket, S3Client } from '@aws-sdk/client-s3'
import { createLogger } from '@nextnode-solutions/logger'

import type { StateWithEtag } from '#/adapters/hetzner/state/read-write.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { ProjectPruneOutcome } from '#/domain/deploy/prune-backups-summary.ts'

const logger = createLogger()

/**
 * Apply the GFS retention policy to ONE project's pg_dump backup bucket
 * (`<project>-backups-dump`). Reusable from both the on-deploy hook
 * (`migrate-remote`) and the daily cron (`pruneBackupsCommand`).
 *
 * A missing bucket is benign and expected: the fleet is enumerated from the
 * VPS state files, which list every routed project - including non-postgres
 * apps that have no dump bucket. `NoSuchBucket` is reported as `bucketMissing`,
 * not an error; every other failure (AccessDenied, throttling) propagates so a
 * broken prune is never mistaken for a clean one.
 */
export async function pruneProjectBackups(
	infraStorage: InfraStorageRuntimeConfig,
	projectName: string,
): Promise<ProjectPruneOutcome> {
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
		const { scanned, pruned } = await prunePostgresBackups(s3, bucket)
		logger.info(
			`Pruned ${String(pruned)}/${String(scanned)} pg_dump backup(s) for "${projectName}" (${bucket}).`,
		)
		return { project: projectName, scanned, pruned, bucketMissing: false }
	} catch (error) {
		if (error instanceof NoSuchBucket) {
			logger.info(
				`No pg_dump backup bucket "${bucket}" for "${projectName}" - skipping (not a postgres project, or never provisioned).`,
			)
			return {
				project: projectName,
				scanned: 0,
				pruned: 0,
				bucketMissing: true,
			}
		}
		throw error
	}
}

// Union the project names off every VPS state file's hostPorts map (a project
// holds a host port on the VPS that routes it). Deduped across VPSs; a state
// object that vanished between list and read (null) is skipped.
function collectProjectNames(
	states: ReadonlyArray<StateWithEtag | null>,
): string[] {
	const names = new Set<string>()
	for (const entry of states) {
		if (entry === null) continue
		for (const project of Object.keys(entry.state.hostPorts)) {
			names.add(project)
		}
	}
	return [...names]
}

/**
 * Standalone cron command: prune the pg_dump backups of EVERY project in the
 * fleet under the GFS policy. Enumerates projects from the R2 state files
 * (`hetzner/<vps>.json` -> `hostPorts` keys) so it needs no per-project config
 * and no VPS access - pruning is a pure R2 list+delete with the infra creds.
 * wal-g manages its own bucket's retention, so only the `-dump` buckets are
 * touched here.
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

	const stateKeys = await stateR2.listKeys(STATE_KEY_PREFIX)
	const vpsNames = [
		...new Set(
			stateKeys
				.map(vpsNameFromStateKey)
				.filter((name): name is string => name !== null),
		),
	]
	logger.info(
		`Pruning postgres backups across ${String(vpsNames.length)} VPS state file(s)...`,
	)

	const states = await Promise.all(
		vpsNames.map(name => readState(stateR2, name)),
	)
	const projectNames = collectProjectNames(states)
	logger.info(
		`Considering ${String(projectNames.length)} project(s) for GFS prune.`,
	)

	const outcomes = await Promise.all(
		projectNames.map(project => pruneProjectBackups(infraStorage, project)),
	)

	writeSummary(buildPruneBackupsSummary(outcomes))
}
