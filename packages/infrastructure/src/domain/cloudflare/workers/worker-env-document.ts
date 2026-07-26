import {
	deriveWorkersBackingConfig,
	typesPlaceholderOutputs,
} from './outputs-env.ts'
import { buildWorkerVars } from './worker-vars.ts'
import { buildWranglerConfig } from './wrangler-config.ts'

import type { ServicesConfig } from '#/config/service-config.ts'
import type { WorkerServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { WranglerDocument } from './wrangler-document.ts'

export interface WorkerEnvInput {
	readonly serviceName: string
	readonly service: WorkerServiceConfig
	// The [services.*] backing block; bindings/vars are filtered per service by
	// its own `needs`, exactly as the deployed wrangler config filters them.
	readonly services: ServicesConfig
	// Every worker of the project. Its keys resolve a sibling listed in `needs`
	// to a service binding (`Fetcher`) rather than a backing binding, and its
	// entries carry the `url`s the peer URL block derives from - so the generated
	// `Env` carries a `<NAME>_URL` for a peer this worker never binds.
	readonly workerServices: Readonly<Record<string, WorkerServiceConfig>>
	// The secret NAMES this worker receives (already expanded: the GLOBAL
	// `[deploy].secrets` pool folded into the service's own).
	readonly secretNames: ReadonlyArray<string>
}

// The generated files depend only on binding/var/secret NAMES, which are the
// same in every environment and every project. These stand in for the value-side
// inputs `buildWranglerConfig`/`buildWorkerVars` require; every value they
// produce (script names, SITE_URL, the R2 endpoint) is discarded by the renderers.
const TYPES_PROJECT_NAME = 'types'
const TYPES_ENVIRONMENT: AppEnvironment = 'production'
const TYPES_PROJECT_DOMAIN = 'types.invalid'
const TYPES_ACCOUNT_ID = 'types'

/**
 * Build the wrangler document a worker's generated files are read from. It is
 * the SAME document `buildWranglerConfig` deploys, fed placeholder provision
 * outputs (types are generated before provision, when no Terraform output
 * exists), so a binding or var can never reach the deployed config while
 * missing from the generated `Env` - or the reverse. Every renderer of a
 * generated file goes through here rather than rebuilding the placeholder
 * plumbing.
 */
export function buildWorkerEnvDocument(
	input: WorkerEnvInput,
): WranglerDocument {
	const backing = deriveWorkersBackingConfig(input.services)
	const outputs = typesPlaceholderOutputs(backing)

	return buildWranglerConfig({
		projectName: TYPES_PROJECT_NAME,
		environment: TYPES_ENVIRONMENT,
		serviceName: input.serviceName,
		service: input.service,
		services: input.services,
		outputs,
		cron: [],
		serviceNames: Object.keys(input.workerServices),
		vars: buildWorkerVars({
			projectDomain: TYPES_PROJECT_DOMAIN,
			environment: TYPES_ENVIRONMENT,
			service: input.service,
			workerServices: input.workerServices,
			backing,
			outputs,
			accountId: TYPES_ACCOUNT_ID,
		}),
	})
}
