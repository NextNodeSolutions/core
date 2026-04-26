import type { DeployableConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

import { SERVICE_DEFINITIONS } from './registry.ts'
import type { Service, ServiceFactoryContext } from './service.ts'

export interface ResolveServicesInput {
	readonly config: DeployableConfig
	readonly environment: AppEnvironment
	readonly cfToken: string
	readonly infraStorage: InfraStorageRuntimeConfig | null
}

/**
 * Walk every registered service definition and return the ones the
 * project opted into. `deploy.command` and `provision.command` iterate
 * the result without knowing which services exist — adding a new
 * service is one entry in `SERVICE_DEFINITIONS`, with zero churn here.
 *
 * Each definition validates its own preconditions (e.g. R2 needs infra
 * storage to be loaded). Cross-service ordering, when it eventually matters,
 * will live on the definitions, not in this loop.
 */
export function resolveServices(
	input: ResolveServicesInput,
): ReadonlyArray<Service> {
	const ctx: ServiceFactoryContext = {
		projectName: input.config.project.name,
		environment: input.environment,
		cfToken: input.cfToken,
		infraStorage: input.infraStorage,
		// TODO(nn-local): plumb 'local' from the future `nn` CLI so each
		// service definition can return its docker-compose-driven variant.
		mode: 'remote',
	}
	const services: Service[] = []
	for (const definition of Object.values(SERVICE_DEFINITIONS)) {
		const service = definition.build(input.config.services, ctx)
		if (service !== null) services.push(service)
	}
	return services
}
