import { parseArgs } from 'node:util'

import type { PostgresServiceConfig } from '#/config/types.ts'
import type { ServiceEnv } from './service.ts'

/**
 * Compose service name for the embedded postgres sidecar. Co-located in
 * the same docker network as the app, reachable as `postgres:5432` -
 * never bound to a host port, so the database is unreachable from outside
 * the VPS unless the app explicitly proxies it.
 */
export const POSTGRES_SIDECAR_SERVICE_NAME = 'postgres'

export const POSTGRES_SIDECAR_PORT = 5432

/**
 * NextNode-blessed postgres major version. Single source of truth for the
 * server image (`postgres:<v>`) and the backup sidecar image
 * (`ghcr.io/solectrus/postgres-s3-backup:<v>`). NextNode runs an
 * externalized-CTO model - clients don't pick their postgres version, we
 * pin one across the fleet so upgrades are coordinated and tested. Bump
 * this single constant to roll out a new major to every NextNode embedded
 * deploy at the next pipeline run; `mode = "external"` users own their
 * own DB and are unaffected. Postgres 18 (released Sep 2025) is supported
 * by the community until Nov 2030.
 */
export const NEXTNODE_POSTGRES_VERSION = '18'

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
 * Volume mount point for the postgres data, INSIDE the official image.
 *
 * postgres:18+ changed the on-disk layout: the image now stores data in a
 * major-version-specific subdirectory and its default `PGDATA` is
 * `/var/lib/postgresql/<major>/docker`, with the `VOLUME` declared at
 * `/var/lib/postgresql` (not the legacy `/var/lib/postgresql/data`). Mounting
 * onto the legacy path trips the image's own guard ("there appears to be
 * PostgreSQL data in /var/lib/postgresql/data (unused mount/volume)") and the
 * container crash-loops on first boot. We mount the named volume at the
 * image's default parent so initdb writes the version subdir into the volume
 * and no `PGDATA` override is needed. See docker-library/postgres#1259 / #37.
 *
 * Pinned to the 18+ layout to match {@link NEXTNODE_POSTGRES_VERSION}; if that
 * pin ever drops below 18, revert this to `/var/lib/postgresql/data`.
 */
export const POSTGRES_DATA_DIR = '/var/lib/postgresql'

/**
 * Compose the `DATABASE_URL` the app uses to reach the embedded sidecar.
 * The host is the docker compose service name (`postgres`), reachable on
 * the project's internal network only - never via a host port binding.
 *
 * The password is percent-encoded: it lands in the URL userinfo, where
 * `/ @ : ? # +` are reserved delimiters, so a value carrying any of them
 * (e.g. a base64 secret inherited from a prior stack) would otherwise
 * mis-parse and break the connection. This is the exact inverse of
 * {@link redactPostgresPassword}, which percent-decodes the userinfo back
 * to the raw byte for libpq - the two round-trip. Alphanumeric passwords
 * (what `ensureEmbeddedPostgresPasswordSecret` generates) are unchanged by
 * `encodeURIComponent`, so existing deploys see no difference.
 */
export function buildPostgresEmbeddedDatabaseUrl(
	projectName: string,
	password: string,
): string {
	const id = postgresProjectIdentifier(projectName)
	return `postgres://${id}:${encodeURIComponent(password)}@${POSTGRES_SIDECAR_SERVICE_NAME}:${String(POSTGRES_SIDECAR_PORT)}/${id}`
}

/**
 * Embedded-mode env contributions. The sidecar reads `POSTGRES_USER`,
 * `POSTGRES_DB`, and `POSTGRES_PASSWORD` from `.env` at first boot to run
 * `initdb`; the app reads `DATABASE_URL` to connect. User and DB names are
 * derived from the project, not secrets, so they travel on the public
 * channel - only the password and the URL (which embeds the password) are
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
 * Cron schedule string consumed by the backup image. `@daily` runs one
 * logical dump per day inside the sidecar. The fine-grained RPO is owned by
 * wal-g (continuous WAL archiving + periodic base backups, see
 * postgres-walg.ts); this pg_dump stream is the portable, cross-version,
 * long-horizon belt to wal-g's suspenders, so a daily cadence is enough - it
 * anchors the GFS retention buckets (`selectPostgresBackupsToPrune`, 7 daily /
 * 4 weekly / 3 monthly). Projects with large, write-heavy databases should
 * move to `[services.postgres].mode = "external"` (managed DB, owns its own
 * backups).
 */
export const POSTGRES_BACKUP_SCHEDULE = '@daily'

/**
 * Age-based retention the backup image enforces itself: after each successful
 * upload, `backup.sh` deletes every dump older than this many days - guarded
 * by `[ -n "$BACKUP_KEEP_DAYS" ]`, so an EMPTY string disables the image-side
 * prune entirely. (A non-empty `'0'` would NOT disable it - `'0'` is truthy to
 * `-n` and would prune everything older than *today*.) We deliberately turn the
 * image prune OFF and make the GFS policy (`selectPostgresBackupsToPrune`, 7
 * daily / 4 weekly / 3 monthly, run on deploy + a daily cron) the SOLE owner of
 * retention: the naive age window cannot express grandfather-father-son, and
 * two pruners racing on one bucket would fight. Keep this empty.
 */
export const POSTGRES_BACKUP_KEEP_DAYS = ''

/**
 * R2 bucket name for the project's pg_dump logical backups. Project-scoped
 * (one per app) and outside the `[services.r2]` bucket list on purpose -
 * backups are infrastructure, not application data, and this bucket is owned
 * by the deploy pipeline, not declared per project. The `-dump` suffix keeps
 * it distinct from the wal-g bucket (`<project>-backups`, see
 * `postgresWalgBucketName`); the two schemes never collide.
 */
export function postgresBackupBucketName(projectName: string): string {
	return `${projectName}-backups-dump`
}

/**
 * S3 key prefix under which the sidecar puts each dump. The image names
 * each file `<POSTGRES_DATABASE>_<timestamp>.dump` where timestamp is
 * `date +%Y-%m-%dT%H:%M:%S` (colons, no `Z`, no milliseconds), so the
 * full key looks like
 * `s3://<project>-backups-dump/postgres/<project_id>_2026-05-16T03:00:00.dump`.
 */
export const POSTGRES_BACKUP_PREFIX = 'postgres'

/**
 * Retention policy bucket sizes - keep the 7 most-recent distinct UTC days,
 * the 4 most-recent ISO-week buckets (Monday-aligned), and the 3 most-recent
 * UTC month buckets. Older snapshots are pruned. Buckets overlap on the
 * newest snapshot (one dump satisfies day + week + month), so the worst-case
 * upper bound is 7 + 4 + 3 = 14 - but with dense daily data the realized
 * count is typically lower because the most-recent weekly and the two most-
 * recent monthly buckets overlap the 7-day window.
 */
export const POSTGRES_BACKUP_RETENTION_DAILY = 7
export const POSTGRES_BACKUP_RETENTION_WEEKLY = 4
export const POSTGRES_BACKUP_RETENTION_MONTHLY = 3

/**
 * Pattern of dumps emitted by `ghcr.io/solectrus/postgres-s3-backup`
 * (and identically by its `eeshugerman/postgres-backup-s3` ancestor -
 * solectrus is a drop-in fork). The image names each file
 * `<POSTGRES_DATABASE>_<timestamp>.dump` where timestamp comes from
 * `date +%Y-%m-%dT%H:%M:%S` (see `src/backup.sh` upstream) - so colons
 * in the time, no trailing `Z`, no milliseconds. The database segment is
 * `postgresProjectIdentifier(projectName)` (lowercase alnum + underscores).
 * Both formats are the image's own - not under our control - so the
 * regex must mirror them exactly.
 */
const POSTGRES_BACKUP_KEY_PATTERN = new RegExp(
	`^${POSTGRES_BACKUP_PREFIX}/[A-Za-z0-9_]+_(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})\\.dump$`,
)

export interface PostgresBackupSnapshot {
	readonly key: string
	readonly timestamp: Date
}

/**
 * Parse an R2 object key emitted by the backup sidecar into a snapshot.
 * Returns `null` when the key does not match the expected pattern - callers
 * filter unknown keys out so retention only ever prunes objects we own.
 *
 * `new Date(iso)` silently rolls impossible-but-in-range dates over
 * (Feb 30 → Mar 2, Apr 31 → May 1). We round-trip the parsed Date back to
 * ISO and reject any key whose timestamp does not match the original - this
 * is what prevents a malformed (or hand-crafted) key from being classified
 * into a bucket it does not belong to and displacing a real snapshot.
 */
export function parsePostgresBackupKey(
	key: string,
): PostgresBackupSnapshot | null {
	const match = POSTGRES_BACKUP_KEY_PATTERN.exec(key)
	if (match === null) return null
	const [, year, month, day, hour, minute, second] = match
	if (!year || !month || !day || !hour || !minute || !second) return null
	const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
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
 * buckets - the union of kept keys is preserved, and the complement is
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

/**
 * Select the snapshot whose timestamp is the latest one at or before
 * `target`. Returns `null` when nothing qualifies (input empty, or every
 * snapshot is strictly newer than `target`). Any input order is accepted.
 *
 * The boundary is inclusive - a snapshot taken at exactly `target` is
 * eligible. `target` is compared via `getTime()`, so a target with an
 * invalid date short-circuits to `null` rather than silently selecting
 * everything (NaN comparisons are always false).
 */
export function selectPostgresBackupForRestore(
	snapshots: ReadonlyArray<PostgresBackupSnapshot>,
	target: Date,
): PostgresBackupSnapshot | null {
	const targetMs = target.getTime()
	if (Number.isNaN(targetMs)) return null
	let best: PostgresBackupSnapshot | null = null
	for (const snap of snapshots) {
		const t = snap.timestamp.getTime()
		if (t > targetMs) continue
		if (best === null || t > best.timestamp.getTime()) best = snap
	}
	return best
}

export interface PostgresRestoreArgs {
	readonly project: string
	readonly at: Date
	readonly yes: boolean
}

/**
 * Parse argv flags for `infrastructure restore`. Accepted shape:
 *
 *   --project <slug>   (required)
 *   --at <iso-date>    (required; anything `new Date()` accepts is OK,
 *                       date-only strings resolve to midnight UTC)
 *   --yes              (optional boolean; the cli command refuses to run
 *                       without it because pg_restore --clean is
 *                       destructive)
 *
 * Pure: argv in, args out. The destructive-confirmation policy lives
 * in `ensurePostgresRestoreConfirmed` - this function only reports
 * `yes` truthfully.
 *
 * Unknown-flag and missing-value rejection comes for free via the
 * node:util `parseArgs` `strict` default - silently ignoring an
 * unrecognised flag (e.g. a typo of `--yes`) would defeat the safety
 * gate, so we lean on the platform parser rather than rolling our own.
 */
export function parsePostgresRestoreArgs(
	argv: ReadonlyArray<string>,
): PostgresRestoreArgs {
	const { values } = parseArgs({
		args: [...argv],
		options: {
			project: { type: 'string' },
			at: { type: 'string' },
			yes: { type: 'boolean', default: false },
		},
	})
	if (!values.project) {
		throw new Error('restore: --project <slug> is required')
	}
	if (!values.at) {
		throw new Error('restore: --at <iso-date> is required')
	}
	const date = new Date(values.at)
	if (Number.isNaN(date.getTime())) {
		throw new Error(`restore: --at "${values.at}" is not a valid ISO date`)
	}
	return { project: values.project, at: date, yes: values.yes }
}

/**
 * Apply the destructive-confirmation gate for `infrastructure restore`.
 * pg_restore `--clean` drops the target objects before recreating them,
 * so we refuse to proceed without an explicit `--yes`. The CLAUDE.md
 * layering rule keeps this decision in the domain (CLI = orchestration
 * only) - the cli command just calls this before any IO happens.
 */
export function ensurePostgresRestoreConfirmed(
	args: PostgresRestoreArgs,
): void {
	if (args.yes) return
	throw new Error(
		'restore is destructive (pg_restore --clean drops + recreates objects). Re-run with --yes to confirm.',
	)
}

export interface RedactedPostgresUrl {
	readonly urlWithoutPassword: string
	readonly password: string
}

/**
 * Split a `postgres://user:pw@host/db?...` URL into the same URL with
 * the password stripped, plus the password itself. Lets the adapter
 * pass the password through `PGPASSWORD` (libpq env) instead of argv,
 * so it stops appearing in `ps aux` / `/proc/<pid>/cmdline`.
 *
 * Pure: takes a string, returns two strings. The URL constructor
 * propagates a `TypeError` for malformed inputs - the adapter does not
 * try to recover, mismatched DATABASE_URL is an operator misconfig.
 *
 * `decodeURIComponent` undoes the percent-encoding `new URL()` retains
 * on the password component so the unescaped value reaches libpq.
 */
export function redactPostgresPassword(
	databaseUrl: string,
): RedactedPostgresUrl {
	const url = new URL(databaseUrl)
	const password = decodeURIComponent(url.password)
	url.password = ''
	return { urlWithoutPassword: url.toString(), password }
}

export interface PostgresBackupSidecarService {
	readonly image: string
	readonly restart: string
	readonly depends_on: ReadonlyArray<string>
	readonly environment: Readonly<Record<string, string>>
}

/**
 * Build the compose sidecar definition for the daily pg_dump backup to R2.
 * Returns `null` outside production (dev runs zero backups, mirroring the
 * wal-g loop) or for `mode = external` (the user owns the database and their
 * own backups). Runs in PARALLEL with the wal-g sidecars: wal-g owns the
 * fine-grained PITR window, this pg_dump stream owns the portable,
 * cross-version, GFS-retained long-horizon snapshots.
 *
 * Image is `ghcr.io/solectrus/postgres-s3-backup` pinned to
 * `NEXTNODE_POSTGRES_VERSION` (kept in sync with the server image so the
 * bundled `pg_dump` matches the running server major). The solectrus image
 * is the maintained fork of the now-unmaintained `eeshugerman/postgres-
 * backup-s3`; it adds support for postgres 17+ and ships an identical
 * env-var contract (`SCHEDULE`, `S3_*`, `POSTGRES_*`, `sh backup.sh`
 * triggering an ad-hoc dump). R2 credentials are INFRA-owned, not the app
 * `[services.r2]` block: the backup bucket `<project>-backups-dump` is infra
 * storage (like the state + certs buckets), reached via a dedicated R2 token
 * scoped to it AND the wal-g bucket. `createPostgresService` provisions the
 * token and `loadEnv` projects it as `POSTGRES_BACKUP_R2_*` into the shared
 * `.env` (the same channel the wal-g sidecars read); those names are renamed
 * to the `S3_*` the image expects via compose interpolation. Dedicated names
 * (not the generic `R2_*`) so a project that ALSO declares `[services.r2]`
 * does not collide in `mergeServiceEnvs`. Image-side age prune is OFF
 * (`BACKUP_KEEP_DAYS` empty); the GFS cron owns retention.
 */
export function buildPostgresBackupSidecar(
	config: PostgresServiceConfig,
	projectName: string,
	environment: string,
): PostgresBackupSidecarService | null {
	if (config.mode !== 'embedded') return null
	if (environment !== 'production') return null

	const id = postgresProjectIdentifier(projectName)

	return {
		image: `ghcr.io/solectrus/postgres-s3-backup:${NEXTNODE_POSTGRES_VERSION}`,
		restart: 'unless-stopped',
		depends_on: [POSTGRES_SIDECAR_SERVICE_NAME],
		environment: {
			SCHEDULE: POSTGRES_BACKUP_SCHEDULE,
			BACKUP_KEEP_DAYS: POSTGRES_BACKUP_KEEP_DAYS,
			S3_REGION: 'auto',
			S3_ACCESS_KEY_ID: '${POSTGRES_BACKUP_R2_ACCESS_KEY_ID}',
			S3_SECRET_ACCESS_KEY: '${POSTGRES_BACKUP_R2_SECRET_ACCESS_KEY}',
			S3_ENDPOINT: '${POSTGRES_BACKUP_R2_ENDPOINT}',
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

// WAL-G archiving + PITR live in ./postgres-walg.ts.
