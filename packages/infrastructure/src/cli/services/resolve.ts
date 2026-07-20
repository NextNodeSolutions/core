import { TARGET_REALISES_BACKING_SERVICES } from '#/config/types.ts'
import { resolveDeployDomain } from '#/domain/deploy/domain.ts'

import { SERVICE_DEFINITIONS } from './registry.ts'

import type { GithubRepository } from '#/cli/env.ts'
import type { DeployableConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { Service, ServiceFactoryContext } from './service.ts'

export interface ResolveServicesInput {
	readonly config: DeployableConfig
	readonly environment: AppEnvironment
	readonly repository: GithubRepository
	readonly cfToken: string
	readonly infraStorage: InfraStorageRuntimeConfig | null
	readonly repoSecrets: Readonly<Record<string, string>>
}

export function resolveServices(
	input: ResolveServicesInput,
): ReadonlyArray<Service> {
	if (TARGET_REALISES_BACKING_SERVICES[input.config.deploy.target]) return []

	const deployDomain = input.config.project.domain
		? resolveDeployDomain(input.config.project.domain, input.environment)
		: null
	const ctx: ServiceFactoryContext = {
		projectName: input.config.project.name,
		environment: input.environment,
		repository: input.repository,
		cfToken: input.cfToken,
		infraStorage: input.infraStorage,
		repoSecrets: input.repoSecrets,
		deployDomain,
	}
	const services: Service[] = []
	for (const definition of Object.values(SERVICE_DEFINITIONS)) {
		const service = definition.build(input.config.services, ctx)
		if (service !== null) services.push(service)
	}
	return services
}
