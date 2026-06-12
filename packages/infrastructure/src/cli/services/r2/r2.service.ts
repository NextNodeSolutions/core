import {
	buildR2ServiceEnv,
	computeR2ServiceBuckets,
} from '#/domain/services/r2.ts'

import { ensureR2Service } from './ensure.ts'
import { loadR2Service } from './load.ts'

import type {
	Service,
	ServiceDefinition,
	ServiceFactoryContext,
} from '#/cli/services/service.ts'
import type { R2ServiceConfig } from '#/config/types.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'

export function createR2Service(
	ctx: ServiceFactoryContext,
	config: R2ServiceConfig,
): Service {
	if (!ctx.infraStorage) {
		throw new Error(
			'r2 service: infra storage (state bucket) must be loaded by the caller - caller invariant broken',
		)
	}
	const { infraStorage } = ctx
	return {
		name: 'r2',
		async provision(): Promise<void> {
			await ensureR2Service({
				cfToken: ctx.cfToken,
				infraStorage,
				projectName: ctx.projectName,
				environment: ctx.environment,
				deployDomain: ctx.deployDomain,
				buckets: config.buckets,
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

/**
 * The R2 service runs whenever any alias is required - either declared
 * explicitly via `[services.r2]` or pulled in implicitly by another
 * service (currently `[services.supabase]`, which adds the `backups`
 * alias). The single token created in `ensureR2Service` covers every
 * alias, so the implicit and explicit buckets share one credential
 * lifecycle.
 */
export const r2ServiceDefinition: ServiceDefinition<'r2'> = {
	name: 'r2',
	build(services, ctx) {
		const buckets = computeR2ServiceBuckets(services)
		if (buckets.length === 0) return null
		return createR2Service(ctx, { buckets })
	},
}
