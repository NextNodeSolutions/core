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
