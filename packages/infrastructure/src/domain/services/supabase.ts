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
