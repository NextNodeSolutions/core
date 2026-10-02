import { resolveDeployDomain } from '#/domain/deploy/domain.ts'

import { deriveWorkerAssetsDirectory } from './assets-directory.ts'
import {
	d1Databases,
	hyperdrive,
	kvNamespaces,
	queueProducers,
	r2Buckets,
} from './backing-bindings.ts'
import { deriveWorkersBackingConfig } from './outputs-env.ts'
import { computeRateLimiterNamespaceId } from './rate-limiter-namespace.ts'
import { deriveBoundSiblings } from './service-bindings.ts'
import { computeWorkerScriptName } from './worker-name.ts'
import {
	DEFAULT_WORKER_CPU_MS,
	DEFAULT_WORKER_SUBREQUESTS,
	DEFAULT_WORKERS_COMPATIBILITY_DATE,
	toBindingName,
	WORKERS_ASSETS_BINDING,
	WORKERS_COMPATIBILITY_FLAGS,
} from './wrangler-document.ts'

import type { WorkerServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { WranglerConfigInput } from './wrangler-config-input.ts'
import type {
	WranglerAssets,
	WranglerDocument,
	WranglerLimits,
	WranglerRateLimit,
	WranglerRoute,
	WranglerServiceBinding,
} from './wrangler-document.ts'

function detectAssets(
	service: WorkerServiceConfig,
): WranglerAssets | undefined {
	// A static-assets-only Worker declares its assets directory explicitly - the
	// config validator requires it, so an undefined `assets` here means a
	// service bypassed validation, and failing loud beats an empty string.
	if (service.entry === false) {
		if (typeof service.assets === 'undefined') {
			throw new Error(
				'a static-assets-only Worker (entry = false) must declare `assets`',
			)
		}
		// No ASSETS binding: it exists so a SCRIPT can fetch assets, and wrangler
		// refuses a binding on an assets-only Worker (nothing can consume it).
		return { directory: service.assets }
	}
	const directory = deriveWorkerAssetsDirectory(service.entry)
	if (typeof directory === 'undefined') return undefined
	return { directory, binding: WORKERS_ASSETS_BINDING }
}

function buildRoutes(
	service: WorkerServiceConfig,
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

function serviceCrons(input: WranglerConfigInput): ReadonlyArray<string> {
	const [primary] = input.serviceNames
	return input.cron
		.filter(job => (job.service ?? primary) === input.serviceName)
		.map(job => job.schedule)
}

// The worker-to-worker service bindings this service declares: one per sibling
// worker it lists in `needs`. `env.<NAME>` binds to the sibling's deployed
// script name, so the caller reaches it by RPC on Cloudflare's edge with no
// public hostname. Backing needs (r2/d1/kv/queues) are not siblings and are
// filtered out; a service that binds no sibling emits no `services` block.
function serviceBindings(
	input: WranglerConfigInput,
): ReadonlyArray<WranglerServiceBinding> | undefined {
	const bound = deriveBoundSiblings(
		input.serviceName,
		input.service.needs,
		input.serviceNames,
	)
	if (!bound.length) return undefined
	return bound.map(name => ({
		binding: toBindingName(name),
		service: computeWorkerScriptName(
			input.projectName,
			input.environment,
			name,
		),
	}))
}

function rateLimiters(
	input: WranglerConfigInput,
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

function workerLimits(service: WorkerServiceConfig): WranglerLimits {
	return {
		cpu_ms: service.limits?.cpuMs ?? DEFAULT_WORKER_CPU_MS,
		subrequests: service.limits?.subrequests ?? DEFAULT_WORKER_SUBREQUESTS,
	}
}

/**
 * Build the wrangler configuration document for one service. Pure: the caller
 * (adapter) writes it to an ephemeral file and runs `wrangler deploy`. Name is
 * `<project>-<env>-<service>`; `workers_dev: false` is emitted unconditionally so
 * NO worker is reachable on `<name>.workers.dev` - a routed service (declaring
 * `url`) answers only on its Custom Domain, an internal one only through service
 * bindings. Bindings are filtered by the service's `needs` (a service that does
 * not `need` a resource never binds it); a sibling worker listed in `needs`
 * becomes a `services` binding - the only worker-to-worker channel; crons
 * targeting this service become `triggers.crons`.
 */
export function buildWranglerConfig(
	input: WranglerConfigInput,
): WranglerDocument {
	const backing = deriveWorkersBackingConfig(input.services)
	const routes = buildRoutes(input.service, input.environment)
	const assets = detectAssets(input.service)
	const crons = serviceCrons(input)
	const services = serviceBindings(input)
	const d1 = d1Databases(input)
	const hyperdriveBindings = hyperdrive(input)
	const kv = kvNamespaces(input, backing)
	const r2 = r2Buckets(input, backing)
	const queues = queueProducers(input, backing)
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
	// A static-assets-only Worker has no script: no `main` and no script env,
	// so the vars block (public env read by the script) is never emitted.
	if (typeof input.service.entry === 'string') {
		document.main = input.service.entry
		if (Object.keys(input.vars).length > 0) document.vars = input.vars
	}
	if (input.service.limits) document.limits = workerLimits(input.service)
	if (routes) document.routes = routes
	if (assets) document.assets = assets
	if (services) document.services = services
	if (d1) document.d1_databases = d1
	if (hyperdriveBindings) document.hyperdrive = hyperdriveBindings
	if (kv) document.kv_namespaces = kv
	if (r2) document.r2_buckets = r2
	if (queues) document.queues = { producers: queues }
	if (limiters) document.ratelimits = limiters
	if (crons.length > 0) document.triggers = { crons }
	return document
}

type WranglerDocumentDraft = {
	-readonly [K in keyof WranglerDocument]: WranglerDocument[K]
}
