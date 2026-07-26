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

// Code-point order, NOT localeCompare: the generated files are regenerated on
// every build and one of them is committed, and localeCompare follows the
// machine's ICU locale (an et_EE contributor sorts Z before T), which would make
// the file churn between developers.
export function byCodePoint(a: string, b: string): number {
	if (a === b) return 0
	return a < b ? -1 : 1
}

/**
 * Every `env.<key>` a worker reads that carries a plain string: its public vars
 * and its secret names. Sorted so the generated files are stable across runs AND
 * machines, and shared by both renderers so the `.dev.vars.example` cannot list a
 * key the generated `Env` does not type.
 */
export function stringEnvKeys(
	document: WranglerDocument,
	secretNames: ReadonlyArray<string>,
): ReadonlyArray<string> {
	return [
		...new Set([...Object.keys(document.vars ?? {}), ...secretNames]),
	].toSorted(byCodePoint)
}

export interface EnvMember {
	readonly name: string
	readonly type: string
}

// Every `env.<key>` bound by the runtime rather than supplied as a string, read
// off the document so the binding names can never diverge from the deployed
// config. The single derivation behind both the generated `Env` and the
// name-reservation rule that keeps a var from shadowing one of these.
export function bindingMembers(
	document: WranglerDocument,
): ReadonlyArray<EnvMember> {
	return [
		...(document.assets
			? [{ name: document.assets.binding, type: 'Fetcher' }]
			: []),
		...(document.services ?? []).map(binding => ({
			name: binding.binding,
			type: 'Fetcher',
		})),
		...(document.d1_databases ?? []).map(binding => ({
			name: binding.binding,
			type: 'D1Database',
		})),
		...(document.kv_namespaces ?? []).map(binding => ({
			name: binding.binding,
			type: 'KVNamespace',
		})),
		...(document.r2_buckets ?? []).map(binding => ({
			name: binding.binding,
			type: 'R2Bucket',
		})),
		...(document.queues?.producers ?? []).map(binding => ({
			name: binding.binding,
			type: 'Queue',
		})),
		...(document.hyperdrive ?? []).map(binding => ({
			name: binding.binding,
			type: 'Hyperdrive',
		})),
	]
}

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
