import type { ServiceName } from '#/config/types.ts'

import { postgresServiceDefinition } from './postgres/postgres.service.ts'
import { r2ServiceDefinition } from './r2/r2.service.ts'
import type { ServiceDefinition } from './service.ts'
import { supabaseServiceDefinition } from './supabase/supabase.service.ts'

/**
 * Registry of every supported service. The mapped-type `satisfies`
 * constraint enforces compile-time completeness against `SERVICE_NAMES`.
 */
export const SERVICE_DEFINITIONS = {
	r2: r2ServiceDefinition,
	postgres: postgresServiceDefinition,
	supabase: supabaseServiceDefinition,
} as const satisfies {
	readonly [K in ServiceName]: ServiceDefinition<K>
}
