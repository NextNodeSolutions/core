import { isAppEnvironment } from '#/domain/environment.ts'

import type { AppEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv } from './service.ts'

/**
 * Infra-owned R2 credentials for the postgres backup sidecars, scoped to the
 * project's two backup buckets (`<project>-backups` wal-g + `<project>-backups-
 * dump` pg_dump). Provisioned at deploy `provision` time, persisted to the
 * infra state bucket, and read back at deploy/migrate time to project the
 * `POSTGRES_BACKUP_R2_*` env vars both schemes' sidecars read.
 */
export interface PostgresBackupCredsState {
	readonly endpoint: string
	readonly accessKeyId: string
	readonly secretAccessKey: string
}

/**
 * Cloudflare API token name for the per-project, per-env postgres backup R2
 * token. Distinct from the R2 service token (`nextnode-r2-*`) and the infra
 * token (`nextnode-infrastructure-r2`) so `revokeStaleTokens` only ever
 * touches this project's backup token. Scoped to both `<project>-backups`
 * (wal-g) and `<project>-backups-dump` (pg_dump).
 */
export function postgresBackupTokenName(
	projectName: string,
	environment: AppEnvironment,
): string {
	return `nextnode-postgres-backup-${projectName}-${environment}`
}

/** State-bucket prefix every project's backup-creds key lives under. */
export const POSTGRES_BACKUP_STATE_PREFIX = 'services/postgres-backup/'

/** State-bucket key holding the persisted backup R2 credentials. */
export function postgresBackupStateKey(
	projectName: string,
	environment: AppEnvironment,
): string {
	return `${POSTGRES_BACKUP_STATE_PREFIX}${projectName}/${environment}.json`
}

/**
 * Inverse of `postgresBackupStateKey`: recover the (project, environment) pair
 * from a backup-creds state key. Returns null for any key that doesn't match
 * the `<prefix><project>/<environment>.json` layout, so the fleet prune can
 * enumerate `POSTGRES_BACKUP_STATE_PREFIX` and silently skip stray objects.
 */
export function parsePostgresBackupStateKey(
	key: string,
): { projectName: string; environment: AppEnvironment } | null {
	if (!key.startsWith(POSTGRES_BACKUP_STATE_PREFIX)) return null
	const rest = key.slice(POSTGRES_BACKUP_STATE_PREFIX.length)
	const match = /^([^/]+)\/([^/]+)\.json$/.exec(rest)
	if (match === null) return null
	const [, projectName, environment] = match
	if (
		typeof projectName === 'undefined' ||
		typeof environment === 'undefined' ||
		!isAppEnvironment(environment)
	) {
		return null
	}
	return { projectName, environment }
}

/**
 * Project the backup R2 credentials into the env the backup sidecar reads via
 * compose interpolation (`${POSTGRES_BACKUP_R2_*}` in `buildPostgresBackupSidecar`).
 * All three travel on the secret channel - the endpoint embeds the account id,
 * and keeping one channel makes the `mergeServiceEnvs` fold trivially correct.
 * Dedicated `POSTGRES_BACKUP_R2_*` names avoid colliding with the app
 * `[services.r2]` block's generic `R2_*` vars.
 */
export function buildPostgresBackupCredsEnv(
	creds: PostgresBackupCredsState,
): ServiceEnv {
	return {
		public: {},
		secret: {
			POSTGRES_BACKUP_R2_ACCESS_KEY_ID: creds.accessKeyId,
			POSTGRES_BACKUP_R2_SECRET_ACCESS_KEY: creds.secretAccessKey,
			POSTGRES_BACKUP_R2_ENDPOINT: creds.endpoint,
		},
	}
}
