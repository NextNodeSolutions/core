import { deriveWorkerAssetsDirectory } from './assets-directory.ts'
import {
	d1Databases,
	hyperdrive,
	kvNamespaces,
	queueProducers,
	r2Buckets,
} from './backing-bindings.ts'
import { deriveWorkersBackingConfig } from './outputs-env.ts'
import { deriveBoundSiblings } from './service-bindings.ts'
import { computeWorkerScriptName } from './worker-name.ts'
import { toBindingName, WORKERS_ASSETS_BINDING } from './wrangler-document.ts'
import { buildWranglerScriptBase } from './wrangler-script-base.ts'

import type { WorkerServiceConfig } from '#/config/types.ts'
import type { WranglerConfigInput } from './wrangler-config-input.ts'
import type {
	WranglerAssets,
	WranglerDocument,
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

/**
 * Build the wrangler configuration document for one Worker service. Pure: the
 * caller (adapter) writes it to an ephemeral file and runs `wrangler deploy`.
 * The envelope (name, routes, limits, `workers_dev: false`) comes from
 * `buildWranglerScriptBase`. Bindings are filtered by the service's `needs` (a
 * service that does not `need` a resource never binds it); a sibling service
 * listed in `needs` becomes a `services` binding - the only worker-to-worker
 * channel, a container's gateway included; crons targeting this service become
 * `triggers.crons`.
 */
export function buildWranglerConfig(
	input: WranglerConfigInput,
): WranglerDocument {
	const backing = deriveWorkersBackingConfig(input.services)
	const assets = detectAssets(input.service)
	const crons = serviceCrons(input)
	const services = serviceBindings(input)
	const d1 = d1Databases(input)
	const hyperdriveBindings = hyperdrive(input)
	const kv = kvNamespaces(input, backing)
	const r2 = r2Buckets(input, backing)
	const queues = queueProducers(input, backing)

	const document = buildWranglerScriptBase(input)
	// A static-assets-only Worker has no script: no `main` and no script env,
	// so the vars block (public env read by the script) is never emitted.
	if (typeof input.service.entry === 'string') {
		document.main = input.service.entry
		if (Object.keys(input.vars).length > 0) document.vars = input.vars
	}
	if (assets) document.assets = assets
	if (services) document.services = services
	if (d1) document.d1_databases = d1
	if (hyperdriveBindings) document.hyperdrive = hyperdriveBindings
	if (kv) document.kv_namespaces = kv
	if (r2) document.r2_buckets = r2
	if (queues) document.queues = { producers: queues }
	if (crons.length > 0) document.triggers = { crons }
	return document
}
