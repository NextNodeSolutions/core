import type { PostgresServiceConfig } from '#/config/types.ts'

import type { ServiceEnv } from './service.ts'

/**
 * Compose service name for the embedded postgres sidecar. Co-located in
 * the same docker network as the app, reachable as `postgres:5432` —
 * never bound to a host port, so the database is unreachable from outside
 * the VPS unless the app explicitly proxies it.
 */
export const POSTGRES_SIDECAR_SERVICE_NAME = 'postgres'

export const POSTGRES_SIDECAR_PORT = 5432

/**
 * Project-scoped database role and database name. The official postgres
 * image's entrypoint reads `POSTGRES_USER` / `POSTGRES_DB` / `POSTGRES_PASSWORD`
 * from the env at first boot and runs `initdb` to create exactly one
 * superuser-owned database. We name both after the project (dashes mapped
 * to underscores so unquoted SQL stays valid) instead of falling back to
 * the image default `postgres/postgres`, so the role + DB are unambiguous
 * in pg_dump output, `psql \du`, and monitoring labels.
 */
export function postgresProjectIdentifier(projectName: string): string {
	return projectName.replaceAll('-', '_')
}

/**
 * Named docker volume holding the postgres data directory. Lives on the
 * VPS local SSD under `/var/lib/docker/volumes/postgres-data/_data`; not
 * a Hetzner Block Volume.
 */
export const POSTGRES_DATA_VOLUME = 'postgres-data'

/**
 * Default postgres data directory inside the official image. The image
 * also accepts `PGDATA` overrides via env, but we mount onto the default
 * so a sidecar with no extra env still persists correctly.
 */
export const POSTGRES_DATA_DIR = '/var/lib/postgresql/data'

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
}

/**
 * Build the compose sidecar definition for the embedded postgres service.
 * Returns `null` when `mode = external` — the app talks to a remote DB
 * and no sidecar is needed.
 */
export function buildPostgresSidecar(
	config: PostgresServiceConfig,
	projectName: string,
): PostgresSidecarService | null {
	if (config.mode !== 'embedded') return null

	const id = postgresProjectIdentifier(projectName)
	return {
		image: `postgres:${config.version}`,
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
}

/**
 * Compose the `DATABASE_URL` the app uses to reach the embedded sidecar.
 * The host is the docker compose service name (`postgres`), reachable on
 * the project's internal network only — never via a host port binding.
 */
export function buildPostgresEmbeddedDatabaseUrl(
	projectName: string,
	password: string,
): string {
	const id = postgresProjectIdentifier(projectName)
	return `postgres://${id}:${password}@${POSTGRES_SIDECAR_SERVICE_NAME}:${String(POSTGRES_SIDECAR_PORT)}/${id}`
}

/**
 * Embedded-mode env contributions. The sidecar reads `POSTGRES_USER`,
 * `POSTGRES_DB`, and `POSTGRES_PASSWORD` from `.env` at first boot to run
 * `initdb`; the app reads `DATABASE_URL` to connect. User and DB names are
 * derived from the project, not secrets, so they travel on the public
 * channel — only the password and the URL (which embeds the password) are
 * masked.
 */
export function buildPostgresEmbeddedEnv(
	projectName: string,
	password: string,
): ServiceEnv {
	const id = postgresProjectIdentifier(projectName)
	return {
		public: {
			POSTGRES_USER: id,
			POSTGRES_DB: id,
		},
		secret: {
			POSTGRES_PASSWORD: password,
			DATABASE_URL: buildPostgresEmbeddedDatabaseUrl(
				projectName,
				password,
			),
		},
	}
}

/**
 * External-mode env contributions. The user owns the database; we only
 * pass the URL through to the app so the rest of the deploy pipeline
 * (e.g. migrate) does not have to re-read secrets independently.
 */
export function buildPostgresExternalEnv(databaseUrl: string): ServiceEnv {
	return {
		public: {},
		secret: { DATABASE_URL: databaseUrl },
	}
}

/**
 * Compose service name for the backup sidecar. Lives in the same docker
 * network as the embedded postgres, reaches it as `postgres:5432`.
 */
export const POSTGRES_BACKUP_SERVICE_NAME = 'postgres-backup'

/**
 * Cron schedule string consumed by the backup image. `@daily` runs once
 * per day at 00:00 UTC inside the sidecar. Plenty granular for the MVP;
 * a config field for it would be premature.
 */
export const POSTGRES_BACKUP_SCHEDULE = '@daily'

/**
 * R2 bucket name for the project's postgres dumps. The bucket is project-
 * scoped (one per app) and lives outside the `[services.r2]` bucket list
 * on purpose — backups are infrastructure, not application data, and the
 * provisioning of this bucket is owned by the deploy pipeline rather than
 * declared per project.
 */
export function postgresBackupBucketName(projectName: string): string {
	return `nn-backups-${projectName}`
}

/**
 * S3 key prefix under which the sidecar puts each dump. Each file is
 * named `<timestamp>.dump` by the backup image, so the full key looks like
 * `s3://nn-backups-<project>/postgres/2026-05-16T03-00-00Z.dump`.
 */
export const POSTGRES_BACKUP_PREFIX = 'postgres'

/**
 * Retention policy bucket sizes — keep the 7 most-recent distinct UTC days,
 * the 4 most-recent ISO-week buckets (Monday-aligned), and the 3 most-recent
 * UTC month buckets. Older snapshots are pruned. Buckets overlap on the
 * newest snapshot (one dump satisfies day + week + month), so the worst-case
 * upper bound is 7 + 4 + 3 = 14 — but with dense daily data the realized
 * count is typically lower because the most-recent weekly and the two most-
 * recent monthly buckets overlap the 7-day window.
 */
export const POSTGRES_BACKUP_RETENTION_DAILY = 7
export const POSTGRES_BACKUP_RETENTION_WEEKLY = 4
export const POSTGRES_BACKUP_RETENTION_MONTHLY = 3

/**
 * Pattern of dumps emitted by `eeshugerman/postgres-backup-s3`. The image
 * names each file `<ISO timestamp with hyphens>.dump`; the prefix is the
 * `S3_PREFIX` we hand the sidecar (see `POSTGRES_BACKUP_PREFIX`), and the
 * timestamp format is the image's own — not under our control. The regex
 * is derived from the constant so changes to the prefix propagate.
 */
const POSTGRES_BACKUP_KEY_PATTERN = new RegExp(
	`^${POSTGRES_BACKUP_PREFIX}/(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2})-(\\d{2})-(\\d{2})Z\\.dump$`,
)

export interface PostgresBackupSnapshot {
	readonly key: string
	readonly timestamp: Date
}

/**
 * Parse an R2 object key emitted by the backup sidecar into a snapshot.
 * Returns `null` when the key does not match the expected pattern — callers
 * filter unknown keys out so retention only ever prunes objects we own.
 *
 * The backup image names dumps `<ISO timestamp with hyphens>.dump` because
 * S3 keys cannot contain colons, so we rebuild a real ISO-8601 string
 * (`T03-00-00Z` → `T03:00:00Z`) before parsing.
 *
 * `new Date(iso)` silently rolls impossible-but-in-range dates over
 * (Feb 30 → Mar 2, Apr 31 → May 1). We round-trip the parsed Date back to
 * ISO and reject any key whose timestamp does not match the original — this
 * is what prevents a malformed (or hand-crafted) key from being classified
 * into a bucket it does not belong to and displacing a real snapshot.
 */
export function parsePostgresBackupKey(
	key: string,
): PostgresBackupSnapshot | null {
	const match = POSTGRES_BACKUP_KEY_PATTERN.exec(key)
	if (match === null) return null
	const [, year, month, day, hour, minute, second] = match
	const iso = `${year!}-${month!}-${day!}T${hour!}:${minute!}:${second!}Z`
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return null
	if (date.toISOString() !== `${iso.slice(0, -1)}.000Z`) return null
	return { key, timestamp: date }
}

const MS_PER_DAY = 86_400_000
const DAYS_PER_WEEK = 7
const SUNDAY_OFFSET_FROM_MONDAY = 6
const ISO_DATE_LENGTH = 10
const ISO_YEAR_MONTH_LENGTH = 7

function dayBucketKey(d: Date): string {
	return d.toISOString().slice(0, ISO_DATE_LENGTH)
}

function weekBucketKey(d: Date): string {
	const utcMidnight = Date.UTC(
		d.getUTCFullYear(),
		d.getUTCMonth(),
		d.getUTCDate(),
	)
	// Monday-aligned: ISO weekday is 1 (Mon) … 7 (Sun); JS getUTCDay() is
	// 0 (Sun) … 6 (Sat). `(day + 6) % 7` yields 0 when Monday and 6 when
	// Sunday, which is the offset back to the week's Monday.
	const offsetToMonday =
		(new Date(utcMidnight).getUTCDay() + SUNDAY_OFFSET_FROM_MONDAY) %
		DAYS_PER_WEEK
	const monday = new Date(utcMidnight - offsetToMonday * MS_PER_DAY)
	return monday.toISOString().slice(0, ISO_DATE_LENGTH)
}

function monthBucketKey(d: Date): string {
	return d.toISOString().slice(0, ISO_YEAR_MONTH_LENGTH)
}

/**
 * Select which postgres backup snapshots to prune under the GFS retention
 * policy (7 daily / 4 weekly / 3 monthly). The newest snapshot in each of
 * the 7 most-recent UTC days is kept; same for the 4 most-recent ISO weeks
 * and the 3 most-recent UTC months. A single dump can satisfy multiple
 * buckets — the union of kept keys is preserved, and the complement is
 * returned as the prune set in input order.
 *
 * Pure: no IO, no clock reads. The caller hands a snapshot list (already
 * listed from R2) and gets back the subset to delete. Trigger and IO live
 * in the cli/adapter layers.
 */
export function selectPostgresBackupsToPrune(
	snapshots: ReadonlyArray<PostgresBackupSnapshot>,
): PostgresBackupSnapshot[] {
	const sortedDesc = snapshots.toSorted(
		(a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
	)

	const keep = new Set<string>()
	const fill = (bucketKey: (d: Date) => string, capacity: number): void => {
		const seen = new Set<string>()
		for (const snap of sortedDesc) {
			if (seen.size >= capacity) return
			const k = bucketKey(snap.timestamp)
			if (seen.has(k)) continue
			seen.add(k)
			keep.add(snap.key)
		}
	}

	fill(dayBucketKey, POSTGRES_BACKUP_RETENTION_DAILY)
	fill(weekBucketKey, POSTGRES_BACKUP_RETENTION_WEEKLY)
	fill(monthBucketKey, POSTGRES_BACKUP_RETENTION_MONTHLY)

	return snapshots.filter(s => !keep.has(s.key))
}

export interface PostgresBackupSidecarService {
	readonly image: string
	readonly restart: string
	readonly depends_on: ReadonlyArray<string>
	readonly environment: Readonly<Record<string, string>>
}

/**
 * Build the compose sidecar definition for the daily postgres backup to
 * R2. Returns `null` when `mode = external` — the user owns the database
 * and is responsible for their own backups.
 *
 * Image is `eeshugerman/postgres-backup-s3` pinned to the postgres major
 * tag (`16`, `17`, ...). It reads `S3_*` + `POSTGRES_*` env vars and runs
 * `pg_dump` on the configured `SCHEDULE`. R2 credentials come from the
 * project's `[services.r2]` block (the `R2_*` env vars are already written
 * to `.env` by the deploy pipeline), renamed to `S3_*` via compose YAML
 * interpolation so the image sees the names it expects.
 */
export function buildPostgresBackupSidecar(
	config: PostgresServiceConfig,
	projectName: string,
): PostgresBackupSidecarService | null {
	if (config.mode !== 'embedded') return null

	const id = postgresProjectIdentifier(projectName)
	const majorVersion = config.version.split('.')[0] ?? config.version

	return {
		image: `eeshugerman/postgres-backup-s3:${majorVersion}`,
		restart: 'unless-stopped',
		depends_on: [POSTGRES_SIDECAR_SERVICE_NAME],
		environment: {
			SCHEDULE: POSTGRES_BACKUP_SCHEDULE,
			BACKUP_KEEP_DAYS: '0',
			S3_REGION: 'auto',
			S3_ACCESS_KEY_ID: '${R2_ACCESS_KEY_ID}',
			S3_SECRET_ACCESS_KEY: '${R2_SECRET_ACCESS_KEY}',
			S3_ENDPOINT: '${R2_ENDPOINT}',
			S3_BUCKET: postgresBackupBucketName(projectName),
			S3_PREFIX: POSTGRES_BACKUP_PREFIX,
			S3_S3V4: 'yes',
			POSTGRES_HOST: POSTGRES_SIDECAR_SERVICE_NAME,
			POSTGRES_DATABASE: id,
			POSTGRES_USER: id,
			POSTGRES_PASSWORD: '${POSTGRES_PASSWORD}',
		},
	}
}
