import {
	NEXTNODE_POSTGRES_VERSION,
	POSTGRES_DATA_DIR,
	POSTGRES_DATA_VOLUME,
	POSTGRES_SIDECAR_PORT,
	POSTGRES_SIDECAR_SERVICE_NAME,
	postgresProjectIdentifier,
} from './postgres.ts'

import type { PostgresServiceConfig } from '#/config/types.ts'

/**
 * NextNode fleet postgres image with WAL-G baked in (see images/postgres-walg/).
 * Used for embedded postgres in EVERY environment so dev and prod run identical
 * binaries; WAL archiving + PITR are switched on only in production (see
 * `buildPostgresSidecar`). The wal-g entrypoint is a transparent no-op when
 * `WALG_S3_PREFIX` is unset, so dev behaves exactly like stock postgres. Pinned
 * to `NEXTNODE_POSTGRES_VERSION`; the `:18` tag is published by the
 * `build-postgres-walg` workflow on changes to the image sources.
 */
export const NEXTNODE_POSTGRES_WALG_IMAGE = `ghcr.io/nextnodesolutions/postgres-walg:${NEXTNODE_POSTGRES_VERSION}`

/**
 * Backup-loop sidecar service name. Runs the SAME fleet image as the server,
 * shares the data volume read-only, and performs the periodic base backups
 * (`wal-g backup-push`) that anchor the WAL chain so PITR has a start point and
 * old WAL can be pruned. WAL archiving itself is the server's archive_command,
 * not this. Production only.
 */
export const POSTGRES_WALG_SERVICE_NAME = 'postgres-walg'

/**
 * RPO knob: postgres force-switches the open WAL segment after this many seconds
 * of activity, so wal-g archives it within the window. 180s => worst-case ~3min
 * of writes lost if the VPS dies between switches (a planned teardown loses zero
 * - it forces a final switch first). Lower = tighter RPO + more R2 PUTs.
 */
export const POSTGRES_WALG_ARCHIVE_TIMEOUT_SECONDS = 180

/** Seconds between base backups (daily). */
export const POSTGRES_WALG_BACKUP_INTERVAL_SECONDS = 86_400

/** Full base backups kept by `wal-g delete retain FULL`; older WAL is pruned. */
export const POSTGRES_WALG_RETAIN_COUNT = 7

/** wal-g compression - lz4 is fast/cheap; forced near-empty segments shrink to KB. */
export const POSTGRES_WALG_COMPRESSION = 'lz4'

/**
 * Per-project R2 bucket holding the wal-g base backups + archived WAL. Distinct
 * from the legacy `nn-backups-<project>` (pg_dump) bucket so the two schemes
 * never collide. wal-g lays out `basebackups_005/` and `wal_005/` under it.
 */
export function postgresWalgBucketName(projectName: string): string {
	return `nn-walg-${projectName}`
}

/** Full `WALG_S3_PREFIX` (bucket root) wal-g reads/writes under. */
export function postgresWalgS3Prefix(projectName: string): string {
	return `s3://${postgresWalgBucketName(projectName)}`
}

/**
 * WALG_* + AWS_* env shared by the server (archive/restore commands) and the
 * backup-loop sidecar. R2 credentials are remapped from the project `.env`
 * (`R2_*`, written by the deploy pipeline) to the AWS_* names wal-g expects via
 * compose `${...}` interpolation. Path-style + region `auto` are R2 requirements.
 */
function buildWalgEnv(projectName: string): Record<string, string> {
	return {
		WALG_S3_PREFIX: postgresWalgS3Prefix(projectName),
		AWS_ACCESS_KEY_ID: '${R2_ACCESS_KEY_ID}',
		AWS_SECRET_ACCESS_KEY: '${R2_SECRET_ACCESS_KEY}',
		AWS_ENDPOINT: '${R2_ENDPOINT}',
		AWS_REGION: 'auto',
		AWS_S3_FORCE_PATH_STYLE: 'true',
		WALG_COMPRESSION_METHOD: POSTGRES_WALG_COMPRESSION,
	}
}

/**
 * Postgres server flags (compose `command`) that turn on continuous WAL
 * archiving to R2. archive_command pushes each completed/forced segment;
 * restore_command is used during archive recovery on a restored data dir (see
 * the image entrypoint). Passed as discrete `-c key=value` argv entries so the
 * spaces in the wal-g commands are NOT shell-split.
 */
function buildWalgPostgresCommand(): string[] {
	return [
		'postgres',
		'-c',
		'wal_level=replica',
		'-c',
		'archive_mode=on',
		'-c',
		'archive_command=wal-g wal-push %p',
		'-c',
		`archive_timeout=${String(POSTGRES_WALG_ARCHIVE_TIMEOUT_SECONDS)}`,
		'-c',
		'restore_command=wal-g wal-fetch %f %p',
	]
}

export interface PostgresSidecarHealthcheck {
	readonly test: ReadonlyArray<string>
	readonly interval: string
	readonly timeout: string
	readonly retries: number
}

export interface PostgresSidecarService {
	readonly image: string
	readonly restart: string
	readonly env_file: ReadonlyArray<string>
	readonly volumes: ReadonlyArray<string>
	readonly healthcheck: PostgresSidecarHealthcheck
	// Production only: postgres flags enabling wal-g archiving (archive_mode,
	// archive_command, archive_timeout, restore_command).
	readonly command?: ReadonlyArray<string>
	// Production only: WALG_* + AWS_* env so archive_command/restore_command (run
	// as the postgres process) can reach R2.
	readonly environment?: Readonly<Record<string, string>>
}

/**
 * Build the compose sidecar definition for the embedded postgres service.
 * Returns `null` when `mode = external` - the app talks to a remote DB and no
 * sidecar is needed.
 *
 * Always uses the fleet `postgres+wal-g` image. In production it adds the
 * postgres flags enabling continuous WAL archiving to R2 (archive_command =
 * `wal-g wal-push`, archive_timeout caps the RPO) plus the WALG_* + AWS_* env
 * the archive/restore commands need. In dev none of that is set: the wal-g
 * entrypoint is a no-op and archive_mode stays off, so it behaves like stock
 * postgres with zero backups.
 */
export function buildPostgresSidecar(
	config: PostgresServiceConfig,
	projectName: string,
	environment: string,
): PostgresSidecarService | null {
	if (config.mode !== 'embedded') return null

	const id = postgresProjectIdentifier(projectName)
	const base: PostgresSidecarService = {
		image: NEXTNODE_POSTGRES_WALG_IMAGE,
		restart: 'unless-stopped',
		env_file: ['.env'],
		volumes: [`${POSTGRES_DATA_VOLUME}:${POSTGRES_DATA_DIR}`],
		healthcheck: {
			test: ['CMD-SHELL', `pg_isready -U ${id} -d ${id}`],
			interval: '10s',
			timeout: '5s',
			retries: 5,
		},
	}
	if (environment !== 'production') return base
	return {
		...base,
		command: buildWalgPostgresCommand(),
		environment: buildWalgEnv(projectName),
	}
}

export interface PostgresWalgSidecarService {
	readonly image: string
	readonly restart: string
	readonly depends_on: ReadonlyArray<string>
	readonly command: ReadonlyArray<string>
	readonly volumes: ReadonlyArray<string>
	readonly environment: Readonly<Record<string, string>>
}

/**
 * Build the wal-g base-backup loop sidecar. Returns `null` outside production
 * (dev runs zero backups) or for `mode = external` (the user owns their DB).
 *
 * Same image as the server (so wal-g + libpq are present), the data volume
 * mounted read-only for file access, and a libpq connection to the server for
 * the non-exclusive pg_backup_start/stop handshake. Interval + retention come
 * from env so the policy stays here in core, not baked into the image.
 */
export function buildPostgresWalgSidecar(
	config: PostgresServiceConfig,
	projectName: string,
	environment: string,
): PostgresWalgSidecarService | null {
	if (config.mode !== 'embedded') return null
	if (environment !== 'production') return null

	const id = postgresProjectIdentifier(projectName)
	return {
		image: NEXTNODE_POSTGRES_WALG_IMAGE,
		restart: 'unless-stopped',
		depends_on: [POSTGRES_SIDECAR_SERVICE_NAME],
		command: ['walg-backup-loop.sh'],
		volumes: [`${POSTGRES_DATA_VOLUME}:${POSTGRES_DATA_DIR}:ro`],
		environment: {
			...buildWalgEnv(projectName),
			WALG_BACKUP_INTERVAL: String(POSTGRES_WALG_BACKUP_INTERVAL_SECONDS),
			WALG_RETAIN_COUNT: String(POSTGRES_WALG_RETAIN_COUNT),
			PGHOST: POSTGRES_SIDECAR_SERVICE_NAME,
			PGPORT: String(POSTGRES_SIDECAR_PORT),
			PGUSER: id,
			PGDATABASE: id,
			PGPASSWORD: '${POSTGRES_PASSWORD}',
		},
	}
}
