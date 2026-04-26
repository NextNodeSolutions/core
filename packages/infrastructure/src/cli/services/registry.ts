import type { ServiceName } from '@/config/types.ts'

import { r2ServiceDefinition } from './r2/r2.service.ts'
import type { ServiceDefinition } from './service.ts'

/**
 * The single registry of every supported service. The mapped-type
 * `satisfies` constraint forces compile-time completeness: extending
 * `SERVICE_NAMES` in `config/types.ts` without registering a definition
 * here is a TypeScript error, not a silent no-op.
 *
 * Adding a service is exactly two diffs:
 *   1. Append the name + config type to `SERVICE_NAMES` /
 *      `ServiceConfigByName` in `config/types.ts`.
 *   2. Add `<name>: <definition>` here.
 *
 * `deploy.command`, `provision.command`, and `resolveServices` stay
 * untouched.
 */
export const SERVICE_DEFINITIONS = {
	r2: r2ServiceDefinition,
} as const satisfies {
	readonly [K in ServiceName]: ServiceDefinition<K>
}
