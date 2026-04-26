import type { R2ServiceConfig } from '@/config/types.ts'
import { buildR2ServiceEnv } from '@/domain/services/r2.ts'
import type { ServiceEnv } from '@/domain/services/service.ts'

import type {
	Service,
	ServiceDefinition,
	ServiceFactoryContext,
} from '../service.ts'

import { ensureR2Service } from './ensure.ts'
import { loadR2Service } from './load.ts'

/**
 * Build the R2 `Service`. Validates that infra storage is loaded — every
 * R2-aware project needs the state bucket to persist credentials.
 *
 * Exported for direct unit testing; production code reaches it through
 * `r2ServiceDefinition` registered in `cli/services/registry.ts`.
 */
export function createR2Service(
	ctx: ServiceFactoryContext,
	config: R2ServiceConfig,
): Service {
	if (!ctx.infraStorage) {
		throw new Error(
			'r2 service: infra storage (state bucket) must be loaded by the caller — caller invariant broken',
		)
	}
	const infraStorage = ctx.infraStorage
	// TODO(nn-local): when ctx.mode === 'local', return a Service that
	// wires a docker-compose minio container and synthesizes ServiceEnv
	// from the local container's creds instead of round-tripping through
	// the remote R2 state bucket. The Service shape stays identical so
	// deploy.command / provision.command remain unchanged.
	return {
		name: 'r2',
		async provision(): Promise<void> {
			await ensureR2Service({
				cfToken: ctx.cfToken,
				infraStorage,
				projectName: ctx.projectName,
				environment: ctx.environment,
				bucketAliases: config.buckets,
			})
		},
		async loadEnv(): Promise<ServiceEnv> {
			const state = await loadR2Service({
				infraStorage,
				projectName: ctx.projectName,
				environment: ctx.environment,
			})
			return buildR2ServiceEnv(state)
		},
	}
}

export const r2ServiceDefinition: ServiceDefinition<'r2'> = {
	name: 'r2',
	build(services, ctx) {
		const config = services.r2
		if (config === undefined) return null
		return createR2Service(ctx, config)
	},
}
