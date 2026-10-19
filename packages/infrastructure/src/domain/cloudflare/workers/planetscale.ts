import type { AppEnvironment } from '#/domain/environment.ts'

// The PlanetScale Terraform provider, pinned to its major. Declared in the
// generated config ONLY when [services.planetscale] is present, so a plain
// workers project never pulls it on `terraform init`.
export const PLANETSCALE_PROVIDER_SOURCE = 'planetscale/planetscale'
export const PLANETSCALE_PROVIDER_VERSION = '~> 1.5'

// A fresh PlanetScale Postgres database initialises a single production branch
// named `main`; the branch-role that produces Hyperdrive's credentials targets
// it.
export const PLANETSCALE_DEFAULT_BRANCH = 'main'

// The Postgres role Terraform creates for Hyperdrive to connect as. Read + write
// all data (runtime DML) - never DDL, since schema migrations run out-of-band
// against a direct connection, not through the pooled Hyperdrive origin.
export const PLANETSCALE_HYPERDRIVE_ROLE = 'hyperdrive'
export const PLANETSCALE_ROLE_INHERITED_ROLES = [
	'pg_read_all_data',
	'pg_write_all_data',
] as const

// PlanetScale Postgres speaks the `postgres` scheme on 5432; these are fixed
// coordinates, not provider outputs.
export const PLANETSCALE_POSTGRES_SCHEME = 'postgres'
export const PLANETSCALE_POSTGRES_PORT = 5432

export function computePlanetscaleDatabaseName(
	projectName: string,
	environment: AppEnvironment,
): string {
	return `${projectName}-${environment}-planetscale`
}

export function computeHyperdriveConfigName(
	projectName: string,
	environment: AppEnvironment,
): string {
	return `${projectName}-${environment}-hyperdrive`
}

// The prefixes of the `<prefix>_{host,database,user,password}` sensitive
// outputs, shared by the generated Terraform and the outputs parser.
export const PLANETSCALE_MIGRATOR_OUTPUT_PREFIX = 'planetscale_migrator'
export const PLANETSCALE_RUNTIME_OUTPUT_PREFIX = 'planetscale_runtime'

// The credentials a PlanetScale branch role exposes through Terraform outputs.
export interface PlanetscaleRoleCredentials {
	readonly host: string
	readonly database: string
	readonly user: string
	readonly password: string
}

/**
 * The `DATABASE_URL` of a branch role: `postgres://` on 5432 with full TLS
 * verification. The one URL format for every consumer (the migrator subprocess,
 * a container's runtime connection).
 */
export function buildPlanetscaleDatabaseUrl(
	credentials: PlanetscaleRoleCredentials,
): string {
	const databaseUrl = new URL(`${PLANETSCALE_POSTGRES_SCHEME}://localhost`)
	databaseUrl.hostname = credentials.host
	databaseUrl.port = String(PLANETSCALE_POSTGRES_PORT)
	databaseUrl.pathname = credentials.database
	databaseUrl.username = credentials.user
	databaseUrl.password = credentials.password
	databaseUrl.searchParams.set('sslmode', 'verify-full')
	return databaseUrl.toString()
}
