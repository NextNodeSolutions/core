import { containerServiceEntries } from './container-services.ts'

import type { DeployServiceConfig } from '#/config/types.ts'

/**
 * Who reaches a backing service decides which access Terraform creates for
 * it: a Worker reads bindings, a container signs with credentials core hands
 * it. Nothing is created for a client the project does not have.
 */
export interface BackingConsumers {
	// A Worker reaches Postgres through the Hyperdrive binding, so the config
	// exists only when a Worker needs planetscale. A container connects with a
	// URL and never needs it.
	readonly hasHyperdrive: boolean
	// A container service connects as the runtime role: its credentials are
	// output. A container on the migrator role reads the migrator's outputs.
	readonly hasPlanetscaleRuntimeContainer: boolean
	// A container that needs r2 signs S3 requests with keys from a Terraform
	// token scoped to the project's buckets. A Worker uses its R2 bindings.
	readonly hasR2Container: boolean
}

interface DeclaredBacking {
	readonly hasPlanetscale: boolean
	readonly hasBuckets: boolean
}

export function deriveBackingConsumers(
	services: Readonly<Record<string, DeployServiceConfig>>,
	declared: DeclaredBacking,
): BackingConsumers {
	const containers = containerServiceEntries(services).map(
		([, service]) => service,
	)
	return {
		hasHyperdrive:
			declared.hasPlanetscale &&
			Object.values(services).some(
				service =>
					service.kind === 'worker' &&
					service.needs.includes('planetscale'),
			),
		hasPlanetscaleRuntimeContainer:
			declared.hasPlanetscale &&
			containers.some(service => service.postgresRole === 'runtime'),
		hasR2Container:
			declared.hasBuckets &&
			containers.some(service => service.needs.includes('r2')),
	}
}
