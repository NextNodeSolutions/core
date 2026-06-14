import { resolveR2PermissionGroupIds } from '#/adapters/cloudflare/permission-groups.ts'
import { createR2Token } from '#/adapters/cloudflare/r2/tokens.ts'
import { R2Client } from '#/adapters/r2/client.ts'
import {
	readPostgresBackupState,
	writePostgresBackupState,
} from '#/adapters/services/postgres-backup-state.ts'
import {
	awaitTokenPropagation,
	revokeStaleTokens,
} from '#/cli/r2/token-lifecycle.ts'
import { deriveR2Credentials } from '#/domain/cloudflare/r2/credentials.ts'
import {
	postgresBackupStateKey,
	postgresBackupTokenName,
} from '#/domain/services/postgres-backup.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { PostgresBackupCredsState } from '#/domain/services/postgres-backup.ts'
import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'

const logger = createLogger()

export interface ProvisionPostgresBackupCredsInput {
	readonly cfToken: string
	readonly infraStorage: InfraStorageRuntimeConfig
	readonly projectName: string
	readonly environment: AppEnvironment
	// Buckets the minted token may read+write. Both postgres backup schemes
	// share ONE token, scoped to the wal-g bucket AND the pg_dump bucket, so
	// the single `POSTGRES_BACKUP_R2_*` channel feeds every backup sidecar.
	readonly bucketNames: ReadonlyArray<string>
}

export interface LoadPostgresBackupCredsInput {
	readonly infraStorage: InfraStorageRuntimeConfig
	readonly projectName: string
	readonly environment: AppEnvironment
}

// State-bucket client: the persisted backup creds live in the infra STATE
// bucket, reached with the infra credentials - never the freshly-minted backup
// token (which is scoped to the backup bucket only and cannot read state).
function stateClient(
	infraStorage: InfraStorageRuntimeConfig,
): ObjectStoreClient {
	return new R2Client({
		endpoint: infraStorage.endpoint,
		accessKeyId: infraStorage.accessKeyId,
		secretAccessKey: infraStorage.secretAccessKey,
		bucket: infraStorage.stateBucket,
	})
}

/**
 * Provision-time bootstrap for the postgres backup R2 credentials. Mints a
 * single Cloudflare R2 API token scoped to the project's backup buckets (the
 * wal-g bucket `<project>-backups` AND the pg_dump bucket
 * `<project>-backups-dump`), waits for it to propagate, revokes any prior
 * token of the same name, then persists the derived S3 credentials to the
 * infra state bucket.
 *
 * Rotates on every call (revoke-by-name), mirroring the R2 service: a leaked
 * or corrupted backup credential self-heals on the next provision without
 * touching the dumps already in the buckets.
 */
export async function provisionPostgresBackupCreds(
	input: ProvisionPostgresBackupCredsInput,
): Promise<void> {
	const { accountId } = input.infraStorage
	const tokenName = postgresBackupTokenName(
		input.projectName,
		input.environment,
	)
	const [probeBucket] = input.bucketNames
	if (probeBucket === undefined) {
		throw new Error(
			'provisionPostgresBackupCreds: bucketNames must not be empty',
		)
	}
	logger.info(
		`Creating postgres backup R2 token "${tokenName}" scoped to ${input.bucketNames.map(b => `"${b}"`).join(', ')}`,
	)
	const permissions = await resolveR2PermissionGroupIds(input.cfToken)
	const tokenResult = await createR2Token({
		token: input.cfToken,
		tokenName,
		accountId,
		bucketNames: input.bucketNames,
		permissions,
	})
	const creds = deriveR2Credentials(tokenResult)

	await awaitTokenPropagation({
		accountId,
		accessKeyId: creds.accessKeyId,
		secretAccessKey: creds.secretAccessKey,
		probeBucket,
	})
	await revokeStaleTokens(input.cfToken, tokenName, tokenResult.id)

	const state: PostgresBackupCredsState = {
		endpoint: input.infraStorage.endpoint,
		accessKeyId: creds.accessKeyId,
		secretAccessKey: creds.secretAccessKey,
	}
	const stateKey = postgresBackupStateKey(
		input.projectName,
		input.environment,
	)
	await writePostgresBackupState(
		stateClient(input.infraStorage),
		stateKey,
		state,
	)
	logger.info(`postgres backup R2 token "${tokenName}" created and persisted`)
}

/**
 * Best-effort load of the backup R2 credentials: returns null when no state
 * exists for the (project, environment). Lets the fleet prune skip projects
 * that never provisioned postgres backups (non-postgres apps) without treating
 * the absence as an error.
 */
export async function tryLoadPostgresBackupCreds(
	input: LoadPostgresBackupCredsInput,
): Promise<PostgresBackupCredsState | null> {
	const stateKey = postgresBackupStateKey(
		input.projectName,
		input.environment,
	)
	return readPostgresBackupState(stateClient(input.infraStorage), stateKey)
}

/**
 * Deploy/migrate-time load of the backup R2 credentials. Throws on missing
 * state - the operator re-runs provision rather than having deploy self-heal
 * (provision always runs before migrate/deploy in the pipeline).
 */
export async function loadPostgresBackupCreds(
	input: LoadPostgresBackupCredsInput,
): Promise<PostgresBackupCredsState> {
	const state = await tryLoadPostgresBackupCreds(input)
	if (!state) {
		throw new Error(
			`postgres backup R2 credentials not found at "${postgresBackupStateKey(input.projectName, input.environment)}" - run provision before deploy`,
		)
	}
	return state
}
