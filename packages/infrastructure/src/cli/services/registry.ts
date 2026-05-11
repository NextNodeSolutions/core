import type { ServiceName } from '#/config/types.ts'

import { r2ServiceDefinition } from './r2/r2.service.ts'
import type { ServiceDefinition } from './service.ts'

// Postgres is registered but not yet implemented. The validator stub lands
// in P3-02 and the sidecar provisioning in P3-03; until then `services.postgres`
// is always undefined and `build` returns null. A non-undefined config means
// a later task wired the validator without wiring this build — fail loudly.
const postgresServiceDefinition: ServiceDefinition<'postgres'> = {
	name: 'postgres',
	build(services) {
		if (services.postgres === undefined) return null
		throw new Error(
			'postgres service: implementation pending (P3-03 sidecar task)',
		)
	},
}

/**
 * Registry of every supported service. The mapped-type `satisfies`
 * constraint enforces compile-time completeness against `SERVICE_NAMES`.
 */
export const SERVICE_DEFINITIONS = {
	r2: r2ServiceDefinition,
	postgres: postgresServiceDefinition,
} as const satisfies {
	readonly [K in ServiceName]: ServiceDefinition<K>
}
