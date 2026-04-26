import type {
	Service,
	ServiceDefinition,
	ServiceFactoryContext,
} from '#/cli/services/service.ts'
import type { R2ServiceConfig } from '#/config/types.ts'
import { buildR2ServiceEnv } from '#/domain/services/r2.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'

import { ensureR2Service } from './ensure.ts'
import { loadR2Service } from './load.ts'

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
