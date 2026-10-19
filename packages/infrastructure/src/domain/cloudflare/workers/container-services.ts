import type {
	ContainerServiceConfig,
	DeployServiceConfig,
} from '#/config/types.ts'

/** The container services of a project, in declaration order. */
export function containerServiceEntries(
	services: Readonly<Record<string, DeployServiceConfig>>,
): ReadonlyArray<readonly [string, ContainerServiceConfig]> {
	return Object.entries(services).flatMap(([name, service]) =>
		service.kind === 'container' ? [[name, service] as const] : [],
	)
}

/** Whether any service of the project runs as a Cloudflare Container. */
export function hasContainerService(
	services: Readonly<Record<string, DeployServiceConfig>>,
): boolean {
	return Object.values(services).some(service => service.kind === 'container')
}
