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
