/**
 * Prometheus community postgres_exporter, pinned. Hosted on quay.io per
 * upstream convention. Bumping this constant rolls out a new exporter
 * version to every NextNode Supabase project on the next pipeline run.
 */
export const POSTGRES_EXPORTER_IMAGE =
	'quay.io/prometheuscommunity/postgres-exporter:v0.18.0'

/**
 * TCP port the exporter listens on. Bound to the VPS Tailscale interface
 * (never the public IP), so the VictoriaMetrics scrape job running on a
 * separate tailnet node is the only consumer.
 */
export const POSTGRES_EXPORTER_PORT = 9187

/** Compose service name for the postgres_exporter sidecar. */
export const POSTGRES_EXPORTER_SERVICE_NAME = 'postgres-exporter'

/**
 * Compose service name of the Supabase database container - matches the
 * upstream `supabase/postgres` self-host stack convention (`db` is what
 * every other Supabase service connects to). The exporter joins the same
 * compose network as `db`.
 */
export const SUPABASE_DB_SERVICE_NAME = 'db'

/**
 * Database initialised inside the Supabase `db` container. Supabase's
 * postgres image runs `initdb -d postgres` and then layers `auth`,
 * `storage`, `realtime` schemas inside it - the exporter connects to
 * `postgres` so it sees the full cluster.
 */
export const SUPABASE_DEFAULT_DATABASE = 'postgres'

/**
 * SQL role the exporter authenticates as. Granted the PG ≥10 built-in
 * `pg_monitor` role (read-only on pg_stat_*, pg_lock_*, etc.), explicitly
 * NOT SUPERUSER.
 */
export const POSTGRES_EXPORTER_USER = 'postgres_exporter'

/**
 * Compose env-var name the exporter receives the DSN through.
 * `DATA_SOURCE_NAME` is the documented contract of the prometheus
 * community postgres_exporter image - any other name is ignored.
 */
export const POSTGRES_EXPORTER_DSN_ENV = 'DATA_SOURCE_NAME'

/**
 * Compose env-var the project's per-project exporter password is injected
 * into via `.env`. The provisioning step (see Phase 6 / P6-06) generates
 * a 32-byte b64 random secret per project, persists it as
 * `PG_EXPORTER_PASSWORD_<PROJECT>` in GitHub, and `convergeVps` writes it
 * into the VPS `.env` under this canonical name so the same compose file
 * works on every host.
 */
export const POSTGRES_EXPORTER_PASSWORD_ENV = 'PG_EXPORTER_PASSWORD'

/**
 * Compose env-var holding the VPS Tailscale IPv4 address. Written into
 * `.env` by the Hetzner cloud-init / convergeVps step, so the exporter
 * port binding resolves to the tailnet interface at compose-up.
 */
export const TAILSCALE_IP_ENV = 'TAILSCALE_IP'

/**
 * Port the Supabase `db` container listens on - the upstream postgres
 * default. The exporter targets this port on the internal compose
 * network only.
 */
const SUPABASE_DB_PORT = 5432

/**
 * Filename of the bootstrap script mounted into the Supabase `db`
 * container's `/docker-entrypoint-initdb.d/`. The numeric `00-` prefix
 * forces this script to run before Supabase's own initdb scripts, so the
 * `postgres_exporter` role exists when downstream scripts that grant
 * privileges (or create publications, etc.) run.
 */
export const POSTGRES_EXPORTER_INIT_FILENAME = '00-pg-monitor.sql'

/**
 * Absolute path the bootstrap file is mounted at inside the `db`
 * container. `/docker-entrypoint-initdb.d/` is the official postgres
 * image's first-boot hook directory - files placed here run exactly once
 * on the initial `initdb` and are then ignored.
 */
export const POSTGRES_EXPORTER_INIT_MOUNT_PATH = `/docker-entrypoint-initdb.d/${POSTGRES_EXPORTER_INIT_FILENAME}`

/**
 * Render the DSN postgres_exporter uses to reach the Supabase `db`
 * service over the internal compose network. `sslmode=disable` because
 * the connection never leaves the docker bridge; password is the caller's
 * to source (a literal for rendered SQL, or the `${PG_EXPORTER_PASSWORD}`
 * compose interpolation for the sidecar env).
 */
export function buildPostgresExporterDsn(password: string): string {
	return `postgresql://${POSTGRES_EXPORTER_USER}:${password}@${SUPABASE_DB_SERVICE_NAME}:${String(SUPABASE_DB_PORT)}/${SUPABASE_DEFAULT_DATABASE}?sslmode=disable`
}

export interface PostgresExporterSidecarService {
	readonly image: string
	readonly restart: string
	readonly depends_on: ReadonlyArray<string>
	readonly ports: ReadonlyArray<string>
	readonly environment: Readonly<Record<string, string>>
}

/**
 * Build the compose sidecar definition for postgres_exporter. The exporter
 * publishes /metrics on `POSTGRES_EXPORTER_PORT`, bound to the VPS
 * Tailscale interface via the compose `.env` `TAILSCALE_IP` substitution
 * - so the exporter is unreachable from the public internet but the
 * monitoring scrape job (running on a separate tailnet node) can reach it.
 * The DSN passes through the env channel as `DATA_SOURCE_NAME` (the
 * exporter image's documented env-var contract) with the per-project
 * `${PG_EXPORTER_PASSWORD}` interpolated at compose-up time.
 *
 * Pure: no IO, no env reads. The caller plugs the returned shape into
 * the compose-file orchestrator.
 */
export function buildPostgresExporterSidecar(): PostgresExporterSidecarService {
	return {
		image: POSTGRES_EXPORTER_IMAGE,
		restart: 'unless-stopped',
		depends_on: [SUPABASE_DB_SERVICE_NAME],
		ports: [
			`\${${TAILSCALE_IP_ENV}}:${String(POSTGRES_EXPORTER_PORT)}:${String(POSTGRES_EXPORTER_PORT)}`,
		],
		environment: {
			[POSTGRES_EXPORTER_DSN_ENV]: buildPostgresExporterDsn(
				`\${${POSTGRES_EXPORTER_PASSWORD_ENV}}`,
			),
		},
	}
}

/**
 * Render the bootstrap SQL that the Supabase `db` container runs once on
 * first boot through `docker-entrypoint-initdb.d`. Creates the
 * `postgres_exporter` role with the supplied password and grants it the
 * PG ≥10 built-in `pg_monitor` role - explicitly NOT SUPERUSER.
 *
 * The `DO ... IF NOT EXISTS` guard makes the script safe to re-run
 * manually (the initdb hook only fires on first boot, but operators may
 * pipe this file through psql later to repair a missing role).
 *
 * Pure: returns the SQL as a string. The caller sources the password
 * (per-project secret `PG_EXPORTER_PASSWORD_<PROJECT>`, see P6-06) and
 * persists the rendered file to disk during provisioning. Base64
 * passwords are safe to single-quote since the alphabet excludes `'`.
 */
export function renderPostgresExporterBootstrapSql(password: string): string {
	return `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${POSTGRES_EXPORTER_USER}') THEN
        CREATE ROLE ${POSTGRES_EXPORTER_USER} WITH LOGIN PASSWORD '${password}';
    END IF;
END
$$;

GRANT pg_monitor TO ${POSTGRES_EXPORTER_USER};
`
}
