import type { DeployServiceConfig } from '#/config/types.ts'
const D1_NEED = 'd1'
export function resolveD1MigrationServiceName(
	services: Readonly<Record<string, DeployServiceConfig>>,
): string {
	for (const [name, service] of Object.entries(services)) {
		if (service.needs.includes(D1_NEED)) return name
	}
	throw new Error(
		'No deploy service declares needs = ["d1"] while [services.d1] is set - at least one Worker must bind the database (needs = ["d1"]) for `wrangler d1 migrations apply` to have a config to run against',
	)
}
