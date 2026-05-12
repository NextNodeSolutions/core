import type { ServiceName } from '#/config/types.ts'

import { r2ServiceDefinition } from './r2/r2.service.ts'
import type { ServiceDefinition } from './service.ts'

// Postgres validation landed in P3-02, so `services.postgres` may now be
// defined. Sidecar provisioning lands in P3-03 — until that ships, any
// non-undefined config has gotten ahead of the implementation and must
// fail loudly rather than silently skip the service.
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
