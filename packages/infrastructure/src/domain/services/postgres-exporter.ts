/**
 * Prometheus community postgres_exporter, pinned. Hosted on quay.io per
 * upstream convention. Bumping this constant rolls out a new exporter
 * version to every NextNode postgres project on the next pipeline run.
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
 * The prometheus community postgres_exporter image accepts the connection
 * split across three env-vars: `DATA_SOURCE_URI` (host[:port]/db?params, NO
 * scheme, NO credentials), `DATA_SOURCE_USER`, and `DATA_SOURCE_PASS`. The
 * exporter uses this form rather than a single URL because its password
 * reuses `POSTGRES_PASSWORD`, which can be ANY byte string (e.g. a base64
 * value inherited from a prior stack) - carrying it in `DATA_SOURCE_PASS`
 * keeps it out of URL userinfo, where `/ @ : ? +` would mis-parse. The
 * password is a discrete field here, so no percent-encoding is needed.
 */
export const POSTGRES_EXPORTER_URI_ENV = 'DATA_SOURCE_URI'
export const POSTGRES_EXPORTER_USER_ENV = 'DATA_SOURCE_USER'
export const POSTGRES_EXPORTER_PASS_ENV = 'DATA_SOURCE_PASS'

/**
 * Compose env-var holding the VPS Tailscale IPv4 address. Written into
 * `.env` by the Hetzner cloud-init / convergeVps step, so the exporter
 * port binding resolves to the tailnet interface at compose-up.
 */
export const TAILSCALE_IP_ENV = 'TAILSCALE_IP'

/**
 * Filename of the bootstrap script mounted into the postgres `db`
 * container's `/docker-entrypoint-initdb.d/`. The numeric `00-` prefix
 * forces this script to run before the image's own initdb scripts, so the
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
 * Compose volume spec mounting the bootstrap SQL into the postgres `db`
 * container as read-only. `:ro` is defensive - postgres only reads
 * `/docker-entrypoint-initdb.d/` scripts, but the bind mount prevents the
 * container from writing back to the host file should that ever change.
 */
export function buildPostgresExporterInitMount(): string {
	return `${POSTGRES_EXPORTER_INIT_HOST_PATH}:${POSTGRES_EXPORTER_INIT_MOUNT_PATH}:ro`
}

export interface EmbeddedPostgresExporterSidecarService {
	readonly image: string
	readonly restart: string
	readonly depends_on: ReadonlyArray<string>
	readonly ports: ReadonlyArray<string>
	readonly environment: Readonly<Record<string, string>>
}

/**
 * Build the exporter sidecar for the embedded postgres service
 * (`[services.postgres] mode = "embedded"`). The exporter publishes
 * /metrics on `POSTGRES_EXPORTER_PORT`, bound to the VPS Tailscale
 * interface via the compose `.env` `TAILSCALE_IP` substitution - so it is
 * unreachable from the public internet but the monitoring scrape job
 * (running on a separate tailnet node) can reach it. The exporter
 * authenticates as the dedicated `postgres_exporter` role (pg_monitor, NOT
 * superuser) created by the bootstrap SQL, whose password deliberately
 * reuses `${POSTGRES_PASSWORD}`: it lives in the same `.env` and the same
 * containers either way, so a separate generated secret would add rotation
 * machinery without shrinking any attack surface.
 *
 * Pure: no IO, no env reads. The caller plugs the returned shape into the
 * compose-file orchestrator.
 */
export function buildEmbeddedPostgresExporterSidecar(
	embeddedServiceName: string,
	embeddedPort: number,
	databaseName: string,
): EmbeddedPostgresExporterSidecarService {
	const uri = `${embeddedServiceName}:${String(embeddedPort)}/${databaseName}?sslmode=disable`
	return {
		image: POSTGRES_EXPORTER_IMAGE,
		restart: 'unless-stopped',
		depends_on: [embeddedServiceName],
		ports: [
			`\${${TAILSCALE_IP_ENV}}:${String(POSTGRES_EXPORTER_PORT)}:${String(POSTGRES_EXPORTER_PORT)}`,
		],
		environment: {
			[POSTGRES_EXPORTER_URI_ENV]: uri,
			[POSTGRES_EXPORTER_USER_ENV]: POSTGRES_EXPORTER_USER,
			[POSTGRES_EXPORTER_PASS_ENV]: `\${${POSTGRES_EXPORTER_EMBEDDED_PASSWORD_ENV}}`,
		},
	}
}

/**
 * Compose env-var the embedded exporter's password interpolates from -
 * the project's own POSTGRES_PASSWORD (see
 * buildEmbeddedPostgresExporterSidecar for why no dedicated secret).
 */
export const POSTGRES_EXPORTER_EMBEDDED_PASSWORD_ENV = 'POSTGRES_PASSWORD'

/**
 * Render the bootstrap SQL that creates the `postgres_exporter` role and
 * grants it the PG ≥10 built-in `pg_monitor` role - explicitly NOT
 * SUPERUSER. It runs through two channels: mounted into
 * `docker-entrypoint-initdb.d/` for a fresh volume's first `initdb`, AND
 * re-executed by the rollout on every deploy (`ensurePostgresExporterRole`)
 * - the initdb hook never fires on a volume that predates the exporter
 * feature, so the deploy-time run is what converges existing stacks.
 *
 * Convergent by construction: `CREATE` is guarded by `IF NOT EXISTS`, and
 * the unconditional `ALTER ROLE` re-asserts LOGIN + password so a rotated
 * `POSTGRES_PASSWORD` propagates to the exporter role on the next deploy.
 *
 * Pure: returns the SQL as a string. The caller sources the password and
 * persists the rendered file to disk during provisioning. The password is
 * interpolated raw into the single-quoted SQL literal; it is safe to
 * single-quote because the embedded exporter reuses `POSTGRES_PASSWORD`,
 * which `ensureEmbeddedPostgresPasswordSecret` auto-generates as an
 * alphanumeric value (no `'`) for exactly this reason.
 */
export function renderPostgresExporterBootstrapSql(password: string): string {
	return `DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${POSTGRES_EXPORTER_USER}') THEN
        CREATE ROLE ${POSTGRES_EXPORTER_USER};
    END IF;
END
$$;

ALTER ROLE ${POSTGRES_EXPORTER_USER} WITH LOGIN PASSWORD '${password}';
GRANT pg_monitor TO ${POSTGRES_EXPORTER_USER};
`
}
