import type { UserServiceConfig } from '#/config/types.ts'

// The backing-service name a workload lists in `needs` to opt into the project
// database. A project declares exactly one [services.postgres], so exactly one
// user service should own its schema.
const POSTGRES_NEED = 'postgres'

/**
 * Resolve the single user service that owns the database schema — the one
 * declaring `needs = ["postgres"]`. Its image runs the migration, because the
 * migrate command (`drizzle-kit migrate` and friends) ships inside the schema
 * owner's build, not a peer's.
 *
 * Only called when the project declares [services.postgres], so exactly one
 * service must claim it. Throw on zero (nobody owns the schema) or more than one
 * (ambiguous — only one image can run the single project database's migration),
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
			'No deploy service declares needs = ["postgres"] while [services.postgres] is set — exactly one service must own the database schema and run its migration',
		)
	}
	if (rest.length > 0) {
		throw new Error(
			`Multiple deploy services declare needs = ["postgres"] (${owners.join(', ')}) — only one can own the migration of the single project database; declare needs = ["postgres"] on the schema owner alone`,
		)
	}
	return owner
}
