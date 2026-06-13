import type { AppEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv } from './service.ts'

/**
 * Infra-owned R2 credentials for the postgres backup sidecar, scoped to the
 * project's `nn-backups-<project>` bucket alone. Provisioned at deploy
 * `provision` time, persisted to the infra state bucket, and read back at
 * deploy/migrate time to project the `POSTGRES_BACKUP_R2_*` env vars.
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
 * touches this project's backup token. Scoped to `nn-backups-<project>`.
 */
export function postgresBackupTokenName(
	projectName: string,
	environment: AppEnvironment,
): string {
	return `nextnode-postgres-backup-${projectName}-${environment}`
}

/** State-bucket key holding the persisted backup R2 credentials. */
export function postgresBackupStateKey(
	projectName: string,
	environment: AppEnvironment,
): string {
	return `services/postgres-backup/${projectName}/${environment}.json`
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
