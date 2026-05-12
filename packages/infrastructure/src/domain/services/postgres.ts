import type { PostgresServiceConfig } from '#/config/types.ts'

/**
 * Compose service name for the embedded postgres sidecar. Co-located in
 * the same docker network as the app, reachable as `postgres:5432` —
 * never bound to a host port, so the database is unreachable from outside
 * the VPS unless the app explicitly proxies it.
 */
export const POSTGRES_SIDECAR_SERVICE_NAME = 'postgres'

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
): PostgresSidecarService | null {
	if (config.mode !== 'embedded') return null

	return {
		image: `postgres:${config.version}`,
		restart: 'unless-stopped',
		env_file: ['.env'],
		volumes: [`${POSTGRES_DATA_VOLUME}:${POSTGRES_DATA_DIR}`],
		healthcheck: {
			test: ['CMD-SHELL', 'pg_isready -U postgres'],
			interval: '10s',
			timeout: '5s',
			retries: 5,
		},
	}
}
