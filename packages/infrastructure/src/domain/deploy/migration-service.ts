import type { UserServiceConfig, WorkerServiceConfig } from '#/config/types.ts'

// The backing-service name a workload lists in `needs` to opt into the project
// database. A project declares exactly one [services.postgres], so exactly one
// user service should own its schema.
const POSTGRES_NEED = 'postgres'

// The backing-service name a Worker lists in `needs` to bind the project D1
// database. Unlike postgres, D1 allows many consumers - but there is one
// database and one migrations directory, so exactly one config drives the apply.
const D1_NEED = 'd1'

/**
 * Resolve the single user service that owns the database schema - the one
 * declaring `needs = ["postgres"]`. Its image runs the migration, because the
 * migrate command (`drizzle-kit migrate` and friends) ships inside the schema
 * owner's build, not a peer's.
 *
 * Only called when the project declares [services.postgres], so exactly one
 * service must claim it. Throw on zero (nobody owns the schema) or more than one
 * (ambiguous - only one image can run the single project database's migration),
 * so the misconfiguration fails before the migrate job spends a snapshot. When
 * databases later become per-service, this generalises to "each owner migrates
 * its own", but today there is one shared database and one owner.
 */
export function resolveMigrationServiceName(
	services: Readonly<Record<string, UserServiceConfig>>,
): string {
	const owners = Object.entries(services)
		.filter(([, service]) => service.needs.includes(POSTGRES_NEED))
		.map(([name]) => name)
	const [owner, ...rest] = owners

	if (owner === undefined) {
		throw new Error(
			'No deploy service declares needs = ["postgres"] while [services.postgres] is set - exactly one service must own the database schema and run its migration',
		)
	}
	if (rest.length > 0) {
		throw new Error(
			`Multiple deploy services declare needs = ["postgres"] (${owners.join(', ')}) - only one can own the migration of the single project database; declare needs = ["postgres"] on the schema owner alone`,
		)
	}
	return owner
}

/**
 * Resolve the Worker whose generated wrangler config drives the D1 migrations
 * apply - the FIRST service (declaration order) that lists `needs = ["d1"]`. D1
 * permits many consumers, so unlike postgres there is no "multiple owners"
 * error: every consumer binds the same single database, and the migrations
 * directory is identical, so the first is a deterministic, sufficient choice.
 *
 * Only called when the project declares [services.d1]; a database declared with
 * no Worker binding it is a misconfiguration (nothing to migrate against), so
 * zero consumers throws before the migrate job runs.
 */
export function resolveD1MigrationServiceName(
	services: Readonly<Record<string, WorkerServiceConfig>>,
): string {
	for (const [name, service] of Object.entries(services)) {
		if (service.needs.includes(D1_NEED)) return name
	}
	throw new Error(
		'No deploy service declares needs = ["d1"] while [services.d1] is set - at least one Worker must bind the database (needs = ["d1"]) for `wrangler d1 migrations apply` to have a config to run against',
	)
}
