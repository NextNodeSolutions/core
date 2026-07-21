import { resolveDeployDomain } from '#/domain/deploy/domain.ts'

import { deriveWorkersBackingConfig } from './outputs-env.ts'
import { computeWorkerScriptName } from './worker-name.ts'
import {
	DEFAULT_WORKERS_COMPATIBILITY_DATE,
	WORKERS_ASSETS_BINDING,
	WORKERS_COMPATIBILITY_FLAGS,
	WORKERS_D1_BINDING,
} from './wrangler-document.ts'

import type {
	CronJobConfig,
	ServicesConfig,
	WorkerServiceConfig,
} from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { WorkersTerraformOutputs } from './outputs-env.ts'
import type {
	WranglerAssets,
	WranglerD1Database,
	WranglerDocument,
	WranglerKvNamespace,
	WranglerQueueProducer,
	WranglerR2Bucket,
	WranglerRoute,
} from './wrangler-document.ts'

// The segment @astrojs/cloudflare (and the wider _worker.js convention) emits:
// the bundle lives at `<dir>/_worker.js/index.js` and the static assets at
// `<dir>`. Splitting on it recovers the assets directory from the entry.
const WORKER_ENTRY_MARKER = '/_worker.js/'

export interface WranglerConfigInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	readonly serviceName: string
	readonly service: WorkerServiceConfig
	// The whole [services.*] block: which backing resources exist (D1/KV/R2/
	// Queues) is read from here, then filtered by the service's own `needs`.
	readonly services: ServicesConfig
	// The provision outputs (ids Terraform emitted). Read straight through - this
	// stays a re-parse-free consumer of `WorkersTerraformOutputs`.
	readonly outputs: WorkersTerraformOutputs
	readonly cron: ReadonlyArray<CronJobConfig>
	// Declaration order of every service, so cron's "primary = first service"
	// default resolves identically to the schema's own rule.
	readonly serviceNames: ReadonlyArray<string>
	// Public runtime vars. Empty for now; US-3.2 fills SITE_URL + peer URLs +
	// backing env. Emitted only when non-empty.
	readonly vars: Readonly<Record<string, string>>
}

function bindingSuffix(alias: string): string {
	return alias.toUpperCase().replaceAll('-', '_')
}

function requireOutput(emitted: string | undefined, what: string): string {
	if (emitted === undefined) {
		throw new Error(
			`${what} is missing from the provision outputs but a service declares it in \`needs\` - run \`infrastructure provision\` before deploy so Terraform creates the resource and emits its output.`,
		)
	}
	return emitted
}

function detectAssets(entry: string): WranglerAssets | undefined {
	const markerIndex = entry.indexOf(WORKER_ENTRY_MARKER)
	if (markerIndex <= 0) return undefined
	return {
		directory: entry.slice(0, markerIndex),
		binding: WORKERS_ASSETS_BINDING,
	}
}

function buildRoutes(
	service: WorkerServiceConfig,
	environment: AppEnvironment,
): ReadonlyArray<WranglerRoute> | undefined {
	if (service.url === undefined) return undefined
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

function d1Databases(
	input: WranglerConfigInput,
): ReadonlyArray<WranglerD1Database> | undefined {
	const { d1 } = input.services
	if (d1 === undefined || !input.service.needs.includes('d1'))
		return undefined
	return [
		{
			binding: WORKERS_D1_BINDING,
			database_name: `${input.projectName}-${input.environment}-d1`,
			database_id: requireOutput(
				input.outputs.d1DatabaseId,
				'd1_database_id',
			),
			...(d1.migrationsFolder === undefined
				? {}
				: { migrations_dir: d1.migrationsFolder }),
		},
	]
}

function kvNamespaces(
	input: WranglerConfigInput,
	backing: ReturnType<typeof deriveWorkersBackingConfig>,
): ReadonlyArray<WranglerKvNamespace> | undefined {
	if (!input.service.needs.includes('kv') || backing.kvAliases.length === 0) {
		return undefined
	}
	return backing.kvAliases.map(alias => ({
		binding: `KV_${bindingSuffix(alias)}`,
		id: requireOutput(
			input.outputs.kvNamespaceIds[alias],
			`kv_namespace_ids["${alias}"]`,
		),
	}))
}

function r2Buckets(
	input: WranglerConfigInput,
	backing: ReturnType<typeof deriveWorkersBackingConfig>,
): ReadonlyArray<WranglerR2Bucket> | undefined {
	if (
		!input.service.needs.includes('r2') ||
		backing.bucketAliases.length === 0
	) {
		return undefined
	}
	return backing.bucketAliases.map(alias => ({
		binding: `R2_${bindingSuffix(alias)}`,
		bucket_name: requireOutput(
			input.outputs.r2Buckets[alias],
			`r2_buckets["${alias}"]`,
		),
	}))
}

function queueProducers(
	input: WranglerConfigInput,
	backing: ReturnType<typeof deriveWorkersBackingConfig>,
): ReadonlyArray<WranglerQueueProducer> | undefined {
	if (
		!input.service.needs.includes('queues') ||
		backing.queueAliases.length === 0
	) {
		return undefined
	}
	// The queue producer binds to the queue NAME (materialised the same way
	// Terraform named it); the provision outputs carry ids, not names.
	return backing.queueAliases.map(alias => ({
		binding: `QUEUE_${bindingSuffix(alias)}`,
		queue: `${input.projectName}-${input.environment}-${alias}`,
	}))
}

/**
 * Build the wrangler configuration document for one service. Pure: the caller
 * (adapter) writes it to an ephemeral file and runs `wrangler deploy`. Name is
 * `<project>-<env>-<service>`; a routed service (declaring `url`) gets a Custom
 * Domain (`workers_dev: false`), an internal one gets neither. Bindings are
 * filtered by the service's `needs` (a service that does not `need` a resource
 * never binds it); crons targeting this service become `triggers.crons`.
 */
export function buildWranglerConfig(
	input: WranglerConfigInput,
): WranglerDocument {
	const backing = deriveWorkersBackingConfig(input.services)
	const routes = buildRoutes(input.service, input.environment)
	const assets = detectAssets(input.service.entry)
	const crons = serviceCrons(input)
	const d1 = d1Databases(input)
	const kv = kvNamespaces(input, backing)
	const r2 = r2Buckets(input, backing)
	const queues = queueProducers(input, backing)

	return {
		name: computeWorkerScriptName(
			input.projectName,
			input.environment,
			input.serviceName,
		),
		main: input.service.entry,
		compatibility_date: DEFAULT_WORKERS_COMPATIBILITY_DATE,
		compatibility_flags: [...WORKERS_COMPATIBILITY_FLAGS],
		...(routes === undefined ? {} : { workers_dev: false, routes }),
		...(assets === undefined ? {} : { assets }),
		...(Object.keys(input.vars).length === 0 ? {} : { vars: input.vars }),
		...(d1 === undefined ? {} : { d1_databases: d1 }),
		...(kv === undefined ? {} : { kv_namespaces: kv }),
		...(r2 === undefined ? {} : { r2_buckets: r2 }),
		...(queues === undefined ? {} : { queues: { producers: queues } }),
		...(crons.length === 0 ? {} : { triggers: { crons } }),
	}
}
