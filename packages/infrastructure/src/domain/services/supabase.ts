/**
 * Pinned image versions for the NextNode-blessed Supabase self-host stack.
 * Bumping any constant rolls out a new version to every project that
 * declares `[services.supabase]` in nextnode.toml on the next pipeline
 * run. Versions follow the upstream supabase/supabase docker-compose
 * template (github.com/supabase/supabase/tree/master/docker), with the
 * postgres image pinned to the latest stable PG 17 release line — the
 * upstream template still defaults to PG 15; NextNode opts into PG 17
 * across the fleet so upgrades stay coordinated and tested.
 */
export const SUPABASE_POSTGRES_IMAGE = 'supabase/postgres:17.6.1.130'
export const SUPABASE_AUTH_IMAGE = 'supabase/gotrue:v2.186.0'
export const SUPABASE_REALTIME_IMAGE = 'supabase/realtime:v2.76.5'
export const SUPABASE_STORAGE_IMAGE = 'supabase/storage-api:v1.48.26'
export const SUPABASE_KONG_IMAGE = 'kong/kong:3.9.1'
export const SUPABASE_STUDIO_IMAGE = 'supabase/studio:2026.04.27-sha-5f60601'

/**
 * Compose service names for the Supabase self-host stack. The `db` name
 * matches the upstream supabase/supabase compose convention — every
 * downstream supabase service connects to `db:5432` on the internal
 * compose network. Keeping the canonical names preserves the runbook
 * compatibility (logs `db`, exec into `auth`, etc.) operators already know.
 */
export const SUPABASE_DB_SERVICE_NAME = 'db'
export const SUPABASE_AUTH_SERVICE_NAME = 'auth'
export const SUPABASE_REALTIME_SERVICE_NAME = 'realtime'
export const SUPABASE_STORAGE_SERVICE_NAME = 'storage'
export const SUPABASE_KONG_SERVICE_NAME = 'kong'
export const SUPABASE_STUDIO_SERVICE_NAME = 'studio'

/**
 * Default database initialised inside the Supabase `db` container. The
 * supabase/postgres image runs `initdb -d postgres` and layers `auth`,
 * `storage`, `realtime` schemas inside that database.
 */
export const SUPABASE_DEFAULT_DATABASE = 'postgres'

/**
 * Named docker volume backing the Supabase postgres data directory. Lives
 * on the VPS local SSD under `/var/lib/docker/volumes/...`, so the
 * database state survives `docker compose down/up` and image bumps.
 */
export const SUPABASE_DB_DATA_VOLUME = 'supabase-db-data'

/**
 * Data directory inside the supabase/postgres image. Identical to the
 * upstream postgres image — supabase only layers initdb scripts on top.
 */
export const SUPABASE_DB_DATA_DIR = '/var/lib/postgresql/data'

/**
 * Port kong listens on inside the supabase compose network. Exposed as
 * a shared constant so the Caddy reverse-proxy build (P7-10) can route
 * the public HTTPS vhost to `kong:${SUPABASE_KONG_HTTP_PORT}` from the
 * same source of truth as the compose .env consumed by kong itself.
 */
export const SUPABASE_KONG_HTTP_PORT = 8000

/**
 * Port supabase/studio listens on inside the compose network. The Caddy
 * reverse-proxy build (P7-11) targets `studio:${SUPABASE_STUDIO_HTTP_PORT}`
 * for the `studio.<deployDomain>` vhost, gated behind basic auth. Mirrors
 * the upstream supabase/supabase docker-compose default.
 */
export const SUPABASE_STUDIO_HTTP_PORT = 3000

/**
 * Lifetime, in seconds, of the JWTs gotrue/realtime/storage sign with
 * JWT_SECRET. Mirrors the upstream supabase docker-compose default —
 * pinned here so deploys are reproducible and the value is reviewed in
 * one place rather than scattered across env files.
 */
export const SUPABASE_JWT_EXPIRY_SECONDS = 3600

/**
 * Default admin username for Supabase Studio behind Caddy basic auth.
 * The matching password (DASHBOARD_PASSWORD) is operator-set per env
 * (see `requireDashboardPasswordSecret`). Mirrors the upstream
 * docker-compose template default; the operator changes it per project
 * only if they have a strong reason to deviate from supabase docs.
 */
export const SUPABASE_DASHBOARD_USERNAME = 'supabase'

export interface SupabaseService {
	readonly image: string
	readonly restart: string
	readonly env_file: ReadonlyArray<string>
	readonly volumes?: ReadonlyArray<string>
	readonly depends_on?: ReadonlyArray<string>
}

export type SupabaseStack = Readonly<Record<string, SupabaseService>>

/** Compose service name for the supabase backup sidecar. */
export const SUPABASE_BACKUP_SERVICE_NAME = 'supabase-backup'

/**
 * Image the backup sidecar runs. `postgres:17-alpine` ships `pg_dump`
 * from the same PG 17 family as SUPABASE_POSTGRES_IMAGE — minor mismatches
 * are tolerated by libpq; major mismatches are not. The alpine variant
 * keeps the pull small; the entrypoint installs `aws-cli` at startup
 * (one-shot per container lifetime under `restart: unless-stopped`),
 * trading a few seconds of cold-start for a smaller base image.
 */
export const SUPABASE_BACKUP_IMAGE = 'postgres:17-alpine'

/**
 * Seconds between successive backups inside the sidecar loop. 86_400 = 24h
 * = daily. The loop is a plain `while true; … sleep 86400` — adding cron
 * would require a second process inside the container and another package
 * install, both for zero functional gain at the daily cadence.
 */
export const SUPABASE_BACKUP_INTERVAL_SECONDS = 86_400

/**
 * Command fragments embedded in the backup script. Kept module-level so
 * every line in `SUPABASE_BACKUP_SCRIPT` is either a single-quoted string
 * (pure shell, `${var}` survives untouched) or a template literal that
 * only carries TS substitutions — no `\${...}` escape juggling anywhere.
 */
const PG_DUMP_COMMAND = `pg_dump -h ${SUPABASE_DB_SERVICE_NAME} -U postgres -d ${SUPABASE_DEFAULT_DATABASE}`
const S3_UPLOAD_COMMAND =
	'aws s3 cp - "s3://${BUCKET}/${key}" --endpoint-url "${ENDPOINT}"'

/**
 * Entrypoint shell script the backup sidecar runs. Constant at module load
 * time: every value that varies per-deploy (project, env, R2 credentials,
 * bucket, endpoint, postgres password) is read from a shell env var the
 * `environment:` block populates. Module-level TS constants (db host, db
 * name, interval seconds) are interpolated once via the command fragments
 * — no per-call rendering.
 *
 * Filename pattern: `pg_dump_<project>_<env>_<YYYYMMDDTHHMMSSZ>.sql.gz`.
 * The backup tracker (monitoring P4) parses project and env directly from
 * the key without listing-time lookups.
 *
 * Errors do not abort the loop — `pg_dump | gzip | aws s3 cp` runs inside
 * an `if`, so a transient R2 outage or db blip logs to stderr but the
 * sidecar tries again the next day. `set -euo pipefail` still propagates
 * inside the pipeline, so an `aws s3 cp` failure after a successful
 * `pg_dump` trips the failure branch.
 */
const SUPABASE_BACKUP_SCRIPT = [
	'set -euo pipefail',
	'apk add --no-cache aws-cli ca-certificates >/dev/null',
	'while true; do',
	'  ts=$(date -u +%Y%m%dT%H%M%SZ)',
	'  key="pg_dump_${PROJECT}_${ENV}_${ts}.sql.gz"',
	`  if ${PG_DUMP_COMMAND} | gzip | ${S3_UPLOAD_COMMAND}; then`,
	'    echo "[supabase-backup] uploaded ${key}"',
	'  else',
	'    echo "[supabase-backup] backup failed at ${ts}" >&2',
	'  fi',
	`  sleep ${String(SUPABASE_BACKUP_INTERVAL_SECONDS)}`,
	'done',
	'',
].join('\n')

export interface SupabaseBackupSidecarService {
	readonly image: string
	readonly restart: string
	readonly depends_on: ReadonlyArray<string>
	readonly environment: Readonly<Record<string, string>>
	readonly entrypoint: ReadonlyArray<string>
}

/**
 * Build the compose sidecar that takes a daily `pg_dump` of the Supabase
 * postgres cluster and uploads the gzipped output to the project's R2
 * `backups` bucket. The bucket is the `backups` alias appended to every
 * supabase project's `[services.r2]` block (see `appendBackupsR2Alias`);
 * its physical name + credentials reach the sidecar through the
 * `BACKUP_R2_*` env vars that P7-13 will populate via
 * `createSupabaseService.loadEnv()`.
 *
 * The image is pinned via SUPABASE_BACKUP_IMAGE (postgres:17-alpine) so
 * the bundled `pg_dump` matches the running supabase/postgres major.
 * The `environment:` block bridges JS-time values (project, env) and
 * compose-interpolation values (R2 + postgres creds) into the shell
 * env vars `SUPABASE_BACKUP_SCRIPT` reads — keeping the script itself a
 * module constant.
 *
 * Pure: no IO, no env reads. The caller plugs the returned shape into
 * the compose-file orchestrator.
 */
export function buildSupabaseBackupSidecar(
	projectName: string,
	environment: string,
): SupabaseBackupSidecarService {
	return {
		image: SUPABASE_BACKUP_IMAGE,
		restart: 'unless-stopped',
		depends_on: [SUPABASE_DB_SERVICE_NAME],
		environment: {
			AWS_ACCESS_KEY_ID: '${BACKUP_R2_ACCESS_KEY_ID}',
			AWS_SECRET_ACCESS_KEY: '${BACKUP_R2_SECRET_ACCESS_KEY}',
			AWS_DEFAULT_REGION: 'auto',
			PGPASSWORD: '${POSTGRES_PASSWORD}',
			BUCKET: '${BACKUP_R2_BUCKET}',
			ENDPOINT: '${BACKUP_R2_ENDPOINT}',
			PROJECT: projectName,
			ENV: environment,
		},
		entrypoint: ['sh', '-c', SUPABASE_BACKUP_SCRIPT],
	}
}

/**
 * Build the Supabase self-host compose stack: db + auth + realtime +
 * storage + kong + studio. Service names match the upstream supabase
 * docker-compose template so operator runbooks transfer untouched.
 *
 * `db` mounts SUPABASE_DB_DATA_VOLUME for persistence. The downstream
 * services depend on `db` via the array form — no healthcheck-conditioned
 * waits are wired here; that's an operational tuning concern handled
 * per-service in a later task. Studio does not depend on `db` directly
 * because it reaches the cluster through kong.
 *
 * No host ports are exposed: reachability is intra-compose only, with
 * external exposure fronted by the VPS reverse proxy and configured
 * separately. All services read configuration from the shared `.env`
 * file populated by the deploy pipeline (JWT secret, anon key, service
 * role key, per-project postgres password, etc. — see Phase 6 backlog).
 *
 * Pure: no IO, no env reads. The caller plugs the returned shape into
 * the compose-file orchestrator.
 */
export function buildSupabaseStack(): SupabaseStack {
	return {
		[SUPABASE_DB_SERVICE_NAME]: {
			image: SUPABASE_POSTGRES_IMAGE,
			restart: 'unless-stopped',
			env_file: ['.env'],
			volumes: [`${SUPABASE_DB_DATA_VOLUME}:${SUPABASE_DB_DATA_DIR}`],
		},
		[SUPABASE_AUTH_SERVICE_NAME]: {
			image: SUPABASE_AUTH_IMAGE,
			restart: 'unless-stopped',
			env_file: ['.env'],
			depends_on: [SUPABASE_DB_SERVICE_NAME],
		},
		[SUPABASE_REALTIME_SERVICE_NAME]: {
			image: SUPABASE_REALTIME_IMAGE,
			restart: 'unless-stopped',
			env_file: ['.env'],
			depends_on: [SUPABASE_DB_SERVICE_NAME],
		},
		[SUPABASE_STORAGE_SERVICE_NAME]: {
			image: SUPABASE_STORAGE_IMAGE,
			restart: 'unless-stopped',
			env_file: ['.env'],
			depends_on: [SUPABASE_DB_SERVICE_NAME],
		},
		[SUPABASE_KONG_SERVICE_NAME]: {
			image: SUPABASE_KONG_IMAGE,
			restart: 'unless-stopped',
			env_file: ['.env'],
			depends_on: [SUPABASE_DB_SERVICE_NAME],
		},
		[SUPABASE_STUDIO_SERVICE_NAME]: {
			image: SUPABASE_STUDIO_IMAGE,
			restart: 'unless-stopped',
			env_file: ['.env'],
		},
	}
}
