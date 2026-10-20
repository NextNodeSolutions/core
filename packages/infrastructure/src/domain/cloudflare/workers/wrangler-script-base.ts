import { resolveDeployDomain } from '#/domain/deploy/domain.ts'

import { computeRateLimiterNamespaceId } from './rate-limiter-namespace.ts'
import { computeWorkerScriptName } from './worker-name.ts'
import {
	DEFAULT_WORKER_CPU_MS,
	DEFAULT_WORKER_SUBREQUESTS,
	DEFAULT_WORKERS_COMPATIBILITY_DATE,
	toBindingName,
	WORKERS_COMPATIBILITY_FLAGS,
} from './wrangler-document.ts'

import type { DeployServiceBase } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type {
	WranglerDocumentDraft,
	WranglerLimits,
	WranglerRateLimit,
	WranglerRoute,
} from './wrangler-document.ts'

// What the Worker script envelope of any service reads: a Worker service, or
// the gateway Worker in front of a container.
export interface WranglerScriptBaseInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly serviceName: string
	readonly service: DeployServiceBase
}

function buildRoutes(
	service: DeployServiceBase,
	environment: AppEnvironment,
): ReadonlyArray<WranglerRoute> | undefined {
	if (typeof service.url === 'undefined') return undefined
	return [
		{
			pattern: resolveDeployDomain(service.url, environment),
			custom_domain: true,
		},
	]
}

function rateLimiters(
	input: WranglerScriptBaseInput,
): ReadonlyArray<WranglerRateLimit> | undefined {
	const declared = input.service.rateLimiters
	if (!declared?.length) return undefined
	return declared.map(limiter => ({
		name: `RL_${toBindingName(limiter.name)}`,
		namespace_id: computeRateLimiterNamespaceId(
			input.projectName,
			input.environment,
			input.serviceName,
			limiter.name,
		),
		simple: { limit: limiter.limit, period: limiter.period },
	}))
}

function workerLimits(service: DeployServiceBase): WranglerLimits {
	return {
		cpu_ms: service.limits?.cpuMs ?? DEFAULT_WORKER_CPU_MS,
		subrequests: service.limits?.subrequests ?? DEFAULT_WORKER_SUBREQUESTS,
	}
}

/**
 * The fields every generated document carries, whatever the service kind.
 * Name is `<project>-<env>-<service>`; `workers_dev: false` is emitted
 * unconditionally so NO worker is reachable on `<name>.workers.dev` - a routed
 * service (declaring `url`) answers only on its Custom Domain, an internal one
 * only through service bindings. Limits and Rate Limit bindings appear only
 * when declared.
 */
export function buildWranglerScriptBase(
	input: WranglerScriptBaseInput,
): WranglerDocumentDraft {
	const routes = buildRoutes(input.service, input.environment)
	const limiters = rateLimiters(input)
	const document: WranglerDocumentDraft = {
		name: computeWorkerScriptName(
			input.projectName,
			input.environment,
			input.serviceName,
		),
		compatibility_date: DEFAULT_WORKERS_COMPATIBILITY_DATE,
		compatibility_flags: [...WORKERS_COMPATIBILITY_FLAGS],
		workers_dev: false,
		observability: { enabled: input.service.observability },
	}
	if (input.service.limits) document.limits = workerLimits(input.service)
	if (routes) document.routes = routes
	if (limiters) document.ratelimits = limiters
	return document
}
