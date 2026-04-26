import type { DeployableConfig } from '@/config/types.ts'
import type { R2RuntimeConfig } from '@/domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '@/domain/environment.ts'

import { createR2Service } from './r2/r2.service.ts'
import type { Service } from './service.ts'

export interface ResolveServicesInput {
	readonly config: DeployableConfig
	readonly environment: AppEnvironment
	readonly cfToken: string
	readonly infraR2: R2RuntimeConfig | null
}

/**
 * Walk the config and return every service the project has opted into.
 *
 * Each `[<service>]` block in `nextnode.toml` corresponds to one branch
 * here. `deploy.command` and `provision.command` iterate over the
 * returned list without knowing what services exist — adding D1/KV/Queues
 * is one new branch + one factory, with zero churn in the commands.
 *
 * Service factories that need infra R2 (state bucket, certs bucket) get
 * it injected here. The invariant — "if you need infra R2, the caller
 * must have loaded it" — is enforced once, locally, instead of being
 * duplicated in both commands.
 */
export function resolveServices(
	input: ResolveServicesInput,
): ReadonlyArray<Service> {
	const services: Service[] = []

	const r2Config = input.config.services.r2
	if (r2Config !== undefined) {
		if (!input.infraR2) {
			throw new Error(
				'resolveServices: R2 service requires infra R2 — invariant broken',
			)
		}
		services.push(
			createR2Service({
				cfToken: input.cfToken,
				infraR2: input.infraR2,
				projectName: input.config.project.name,
				environment: input.environment,
				bucketAliases: r2Config.buckets,
			}),
		)
	}

	return services
}
