import { resolveDeployDomain } from '#/domain/deploy/domain.ts'

import type {
	CloudflareWorkersDeployableConfig,
	WorkerServiceConfig,
} from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { WorkerPublicPathsRule } from './terraform-firewall.ts'
import type { WorkerRateLimitRule } from './terraform-rate-limit.ts'

interface RoutedWorker {
	readonly serviceName: string
	readonly host: string
	readonly service: WorkerServiceConfig
}

export interface WorkerZoneRules {
	readonly rateLimitRules: ReadonlyArray<WorkerRateLimitRule>
	readonly publicPathsRules: ReadonlyArray<WorkerPublicPathsRule>
}

// The workers whose barriers become ZONE rules: they match on the host, which
// only a routed worker has. A zone owns ONE ruleset entry point per phase, so
// dev and prod workspaces would overwrite each other's rules if both emitted
// them - hence production only, the same reason Redirect Rules are.
function deriveRoutedWorkers(
	config: CloudflareWorkersDeployableConfig,
	environment: AppEnvironment,
): ReadonlyArray<RoutedWorker> {
	if (environment !== 'production') return []
	return Object.entries(config.deploy.services).flatMap(
		([serviceName, service]) => {
			const { url } = service
			if (typeof url === 'undefined') return []
			return [
				{
					serviceName,
					host: resolveDeployDomain(url, environment),
					service,
				},
			]
		},
	)
}

export function deriveZoneRules(
	config: CloudflareWorkersDeployableConfig,
	environment: AppEnvironment,
): WorkerZoneRules {
	const routed = deriveRoutedWorkers(config, environment)
	return {
		rateLimitRules: routed.flatMap(({ serviceName, host, service }) =>
			service.rateLimit
				? [{ serviceName, host, rateLimit: service.rateLimit }]
				: [],
		),
		publicPathsRules: routed.flatMap(({ serviceName, host, service }) =>
			service.publicPaths
				? [{ serviceName, host, publicPaths: service.publicPaths }]
				: [],
		),
	}
}
