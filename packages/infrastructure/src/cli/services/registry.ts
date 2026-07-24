import { observabilityServiceDefinition } from './observability/observability.service.ts'
import { postgresServiceDefinition } from './postgres/postgres.service.ts'
import { r2ServiceDefinition } from './r2/r2.service.ts'
import { terraformBackedServiceDefinition } from './terraform-backed-service.ts'

import type { ServiceName } from '#/config/service-config.ts'
import type { ServiceDefinition } from './service.ts'

/**
 * Registry of every supported service. The mapped-type `satisfies`
 * constraint enforces compile-time completeness against `SERVICE_NAMES`.
 * D1/KV/Queues are Terraform-backed (see `terraformBackedServiceDefinition`):
 * they carry no CLI-side provisioning.
 */
export const SERVICE_DEFINITIONS = {
	r2: r2ServiceDefinition,
	postgres: postgresServiceDefinition,
	observability: observabilityServiceDefinition,
	d1: terraformBackedServiceDefinition('d1'),
	kv: terraformBackedServiceDefinition('kv'),
	queues: terraformBackedServiceDefinition('queues'),
	planetscale: terraformBackedServiceDefinition('planetscale'),
} as const satisfies {
	readonly [K in ServiceName]: ServiceDefinition<K>
}
