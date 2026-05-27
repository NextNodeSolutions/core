import {
	SUPABASE_DB_SERVICE_NAME,
	SUPABASE_DEFAULT_DATABASE,
} from './supabase.ts'

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
 * Per-project GitHub org secret name carrying the exporter password.
 * Project names are kebab-case lowercase; GitHub secrets accept only
 * `[A-Z0-9_]`, so hyphens map to underscores and the whole identifier
 * uppercases. Same name flows through `ALL_SECRETS` at deploy time.
 */
export function pgExporterPasswordSecretName(projectName: string): string {
	return `${POSTGRES_EXPORTER_PASSWORD_ENV}_${projectName.replace(/-/g, '_').toUpperCase()}`
}

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
 * Host-side path the bootstrap file lives at, relative to the compose
 * file directory. The provisioning step writes the rendered SQL next to
 * `compose.yaml` on the VPS, so docker-compose's relative-path resolution
 * picks it up at `compose up` time.
 */
export const POSTGRES_EXPORTER_INIT_HOST_PATH = `./${POSTGRES_EXPORTER_INIT_FILENAME}`

/**
 * Compose volume spec mounting the bootstrap SQL into the Supabase `db`
 * container as read-only. `:ro` is defensive - postgres only reads
 * `/docker-entrypoint-initdb.d/` scripts, but the bind mount prevents the
 * container from writing back to the host file should that ever change.
 */
export function buildPostgresExporterInitMount(): string {
	return `${POSTGRES_EXPORTER_INIT_HOST_PATH}:${POSTGRES_EXPORTER_INIT_MOUNT_PATH}:ro`
}

/**
 * Env-var the prometheus community postgres_exporter reads to discover an
 * extra custom-queries YAML (additive to its built-in metric set). Matches
 * the upstream `--extend.query-path` flag.
 */
export const POSTGRES_EXPORTER_QUERIES_ENV = 'PG_EXPORTER_EXTEND_QUERY_PATH'

/**
 * Host-side filename of the custom queries YAML, written next to
 * `compose.yaml` by the provisioning step. Kebab-case to match the rest of
 * the host-side artefacts.
 */
export const POSTGRES_EXPORTER_QUERIES_FILENAME = 'pg-exporter-queries.yaml'

/**
 * Host-side path used in the compose bind mount, resolved relative to the
 * compose file directory by docker-compose at `compose up` time.
 */
export const POSTGRES_EXPORTER_QUERIES_HOST_PATH = `./${POSTGRES_EXPORTER_QUERIES_FILENAME}`

/**
 * In-container path the exporter reads the custom queries from. Lives
 * under `/etc/postgres_exporter/` to keep it out of the data dir and
 * outside any image-managed path.
 */
export const POSTGRES_EXPORTER_QUERIES_MOUNT_PATH =
	'/etc/postgres_exporter/queries.yaml'

/**
 * Cardinality cap on the per-statement metric set. The exporter scrapes
 * the top-N rows of `pg_stat_statements` ordered by `total_exec_time`, so
 * this is the maximum number of `pg_stat_statements_top_*` series the
 * exporter can emit per scrape, regardless of how many statements the
 * cluster has seen.
 */
export const POSTGRES_EXPORTER_TOP_QUERIES_LIMIT = 50

/**
 * Compose volume spec bind-mounting the custom queries YAML into the
 * exporter container as read-only. `ro` is mandatory here - the exporter
 * never writes back.
 */
export function buildPostgresExporterQueriesMount(): string {
	return `${POSTGRES_EXPORTER_QUERIES_HOST_PATH}:${POSTGRES_EXPORTER_QUERIES_MOUNT_PATH}:ro`
}

/**
 * Render the custom queries YAML the exporter loads via
 * `PG_EXPORTER_EXTEND_QUERY_PATH`. Two metric sets:
 *
 *   - `pg_stat_statements_top`: top-N statements by `total_exec_time` with
 *     per-statement `calls`, `total_exec_time`, `mean_exec_time`, `rows`.
 *     The `query` LABEL collapses to `sha256(normalized_statement)[0:16]_
 *     <first 80 chars>` - bounded length, deterministic, PII-safe (the
 *     `query` column from `pg_stat_statements` is already normalised by
 *     postgres: literals are replaced by `$N` placeholders).
 *   - `pg_stat_statements_global`: cluster-wide aggregates - total calls,
 *     total rows, total exec time, and the p95 of per-statement
 *     `mean_exec_time` via `percentile_cont`.
 *
 * Requires the `pgcrypto` extension for `digest(query, 'sha256')`; this
 * extension is enabled by default on the supabase/postgres image. The
 * `LIMIT` is hard-coded from `POSTGRES_EXPORTER_TOP_QUERIES_LIMIT` so the
 * cardinality contract is enforced from this module.
 *
 * Pure: returns the YAML as a string. The provisioning step writes the
 * rendered file to disk on the VPS next to `compose.yaml`.
 */
export function renderPostgresExporterQueriesYaml(): string {
	const topLimit = String(POSTGRES_EXPORTER_TOP_QUERIES_LIMIT)
	return `pg_stat_statements_top:
  query: |
    SELECT
      substring(encode(digest(query, 'sha256'), 'hex'), 1, 16) || '_' || substring(query, 1, 80) AS query,
      calls,
      total_exec_time,
      mean_exec_time,
      rows
    FROM pg_stat_statements
    ORDER BY total_exec_time DESC
    LIMIT ${topLimit};
  metrics:
    - query:
        usage: "LABEL"
        description: "sha256(normalized_statement)[0:16]_<first 80 chars>"
    - calls:
        usage: "COUNTER"
        description: "Total number of times the statement was executed"
    - total_exec_time:
        usage: "COUNTER"
        description: "Total time spent in the statement in milliseconds"
    - mean_exec_time:
        usage: "GAUGE"
        description: "Mean time spent per execution in milliseconds"
    - rows:
        usage: "COUNTER"
        description: "Total rows retrieved or affected by the statement"
pg_stat_statements_global:
  query: |
    SELECT
      sum(calls) AS total_calls,
      sum(rows) AS total_rows,
      sum(total_exec_time) AS total_exec_time_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY mean_exec_time) AS mean_exec_time_p95_ms
    FROM pg_stat_statements;
  metrics:
    - total_calls:
        usage: "COUNTER"
        description: "Cluster-wide sum of statement executions"
    - total_rows:
        usage: "COUNTER"
        description: "Cluster-wide sum of rows retrieved or affected"
    - total_exec_time_ms:
        usage: "COUNTER"
        description: "Cluster-wide cumulative execution time in milliseconds"
    - mean_exec_time_p95_ms:
        usage: "GAUGE"
        description: "p95 of per-statement mean execution time in milliseconds"
`
}

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
	readonly volumes: ReadonlyArray<string>
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
			[POSTGRES_EXPORTER_QUERIES_ENV]:
				POSTGRES_EXPORTER_QUERIES_MOUNT_PATH,
		},
		volumes: [buildPostgresExporterQueriesMount()],
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
