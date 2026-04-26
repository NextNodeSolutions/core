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

export function resolveServices(
	input: ResolveServicesInput,
): ReadonlyArray<Service> {
	const ctx: ServiceFactoryContext = {
		projectName: input.config.project.name,
		environment: input.environment,
		cfToken: input.cfToken,
		infraStorage: input.infraStorage,
	}
	const services: Service[] = []
	for (const definition of Object.values(SERVICE_DEFINITIONS)) {
		const service = definition.build(input.config.services, ctx)
		if (service !== null) services.push(service)
	}
	return services
}
