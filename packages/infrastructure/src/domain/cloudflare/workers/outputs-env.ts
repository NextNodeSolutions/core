import { computeR2Endpoint } from '#/domain/cloudflare/r2/addressing.ts'
import { computeR2ServiceBuckets } from '#/domain/services/r2.ts'
import { isRecord } from '#/kernel/guards.ts'

import type { ServicesConfig } from '#/config/types.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'

/**
 * The Terraform outputs the cloudflare-workers `main.tf.json` emits, narrowed
 * from the raw `terraform output -json` envelope (`{<name>: {value: ...}}`).
 * Only backing services that exist in the config produce an output, so every
 * field is present-or-empty: a project with no D1 has no `d1DatabaseId`, a
 * project with no KV has an empty `kvNamespaceIds` map. Keys are the dev's
 * declared aliases; values are the ids/URLs Terraform computed.
 */
export interface WorkersTerraformOutputs {
	readonly d1DatabaseId?: string
	// The `cloudflare_hyperdrive_config` id - consumed by the `hyperdrive` wrangler
	// binding, never projected as an env var (the Worker reaches Postgres through
	// the binding, not a string). Present only when [services.planetscale] exists.
	readonly hyperdriveConfigId?: string
	readonly kvNamespaceIds: Readonly<Record<string, string>>
	readonly queueIds: Readonly<Record<string, string>>
	readonly r2Buckets: Readonly<Record<string, string>>
	readonly r2CdnUrls: Readonly<Record<string, string>>
}

// The outputs of a project with no backing resources: nothing was applied, so
// every map is empty. Used to skip a Terraform round-trip when nothing is
// declared, instead of reading outputs that would all be absent.
export const EMPTY_WORKERS_TERRAFORM_OUTPUTS: WorkersTerraformOutputs = {
	kvNamespaceIds: {},
	queueIds: {},
	r2Buckets: {},
	r2CdnUrls: {},
}

/**
 * The backing resources a project declares, distilled from `[services.*]`.
 * Drives the env projection: which outputs to expect (and fail loud on if
 * missing) and which env keys to emit. Derived once from the config so the
 * mapping never guesses from whatever Terraform happened to return.
 */
export interface WorkersBackingConfig {
	readonly hasD1: boolean
	readonly hasPlanetscale: boolean
	readonly kvAliases: ReadonlyArray<string>
	readonly queueAliases: ReadonlyArray<string>
	readonly bucketAliases: ReadonlyArray<string>
	readonly cdnBucketAliases: ReadonlyArray<string>
}

export function deriveWorkersBackingConfig(
	services: ServicesConfig,
): WorkersBackingConfig {
	const buckets = computeR2ServiceBuckets(services)
	return {
		hasD1: Boolean(services.d1),
		hasPlanetscale: Boolean(services.planetscale),
		kvAliases: (services.kv?.namespaces ?? []).map(
			namespace => namespace.name,
		),
		queueAliases: (services.queues?.queues ?? []).map(queue => queue.name),
		bucketAliases: buckets.map(bucket => bucket.name),
		cdnBucketAliases: buckets
			.filter(bucket => bucket.cdn)
			.map(bucket => bucket.name),
	}
}

export function hasWorkersBacking(backing: WorkersBackingConfig): boolean {
	return (
		backing.hasD1 ||
		backing.hasPlanetscale ||
		backing.kvAliases.length > 0 ||
		backing.queueAliases.length > 0 ||
		backing.bucketAliases.length > 0
	)
}

function extractValue(
	raw: Readonly<Record<string, unknown>>,
	name: string,
): unknown {
	const entry = raw[name]
	if (typeof entry === 'undefined') return undefined
	if (!isRecord(entry) || !('value' in entry)) {
		throw new Error(
			`terraform output "${name}": entry is missing a "value" field`,
		)
	}
	return entry.value
}

function asString(outputValue: unknown, name: string): string {
	if (typeof outputValue !== 'string') {
		throw new Error(`terraform output "${name}": expected a string value`)
	}
	return outputValue
}

function asStringMap(
	outputValue: unknown,
	name: string,
): Record<string, string> {
	if (!isRecord(outputValue)) {
		throw new Error(`terraform output "${name}": expected an object value`)
	}
	const map: Record<string, string> = {}
	for (const [key, entry] of Object.entries(outputValue)) {
		if (typeof entry !== 'string') {
			throw new Error(
				`terraform output "${name}": entry "${key}" is not a string`,
			)
		}
		map[key] = entry
	}
	return map
}

/**
 * Narrow the raw `terraform output -json` object into the typed outputs. A
 * declared-but-absent output is NOT an error here (the map is simply empty);
 * the "declared service missing its output" check lives in
 * `buildWorkersBackingEnv`, where the config says what MUST be present.
 */
function optionalStringMap(
	outputValue: unknown,
	name: string,
): Record<string, string> {
	if (typeof outputValue === 'undefined') return {}
	return asStringMap(outputValue, name)
}

type WorkersTerraformOutputsDraft = {
	-readonly [K in keyof WorkersTerraformOutputs]: WorkersTerraformOutputs[K]
}

export function parseTerraformOutputs(
	raw: Readonly<Record<string, unknown>>,
): WorkersTerraformOutputs {
	const d1 = extractValue(raw, 'd1_database_id')
	const hyperdrive = extractValue(raw, 'hyperdrive_config_id')
	const kv = extractValue(raw, 'kv_namespace_ids')
	const queues = extractValue(raw, 'queue_ids')
	const buckets = extractValue(raw, 'r2_buckets')
	const cdn = extractValue(raw, 'r2_cdn_urls')
	const outputs: WorkersTerraformOutputsDraft = {
		kvNamespaceIds: optionalStringMap(kv, 'kv_namespace_ids'),
		queueIds: optionalStringMap(queues, 'queue_ids'),
		r2Buckets: optionalStringMap(buckets, 'r2_buckets'),
		r2CdnUrls: optionalStringMap(cdn, 'r2_cdn_urls'),
	}
	if (typeof d1 !== 'undefined') {
		outputs.d1DatabaseId = asString(d1, 'd1_database_id')
	}
	if (typeof hyperdrive !== 'undefined') {
		outputs.hyperdriveConfigId = asString(hyperdrive, 'hyperdrive_config_id')
	}
	return outputs
}

function envKeyFor(alias: string): string {
	return alias.toUpperCase().replaceAll('-', '_')
}

function requireScalar(scalar: string | undefined, output: string): string {
	if (typeof scalar === 'undefined') {
		throw new Error(
			`terraform output "${output}" is missing but the service is declared - run \`infrastructure provision\` before deploy so Terraform creates the resource and emits its output.`,
		)
	}
	return scalar
}

function requireEntry(
	map: Readonly<Record<string, string>>,
	alias: string,
	output: string,
): string {
	const entry = map[alias]
	if (typeof entry === 'undefined') {
		throw new Error(
			`terraform output "${output}" has no entry for "${alias}" but the service is declared - run \`infrastructure provision\` before deploy so Terraform creates the resource and emits its output.`,
		)
	}
	return entry
}

/**
 * Project the Terraform outputs into the `ServiceEnv` a Worker's runtime
 * consumes. Everything Terraform produces is public (ids and names are not
 * secrets); `R2_ENDPOINT` is computed from the account id (Terraform never
 * sees it). A service declared in the config with no matching output fails
 * loud with a "run provision" message - the collision/absence guarantees are
 * the same contract the VPS backing env holds.
 */
export function buildWorkersBackingEnv(
	outputs: WorkersTerraformOutputs,
	accountId: string,
	backing: WorkersBackingConfig,
): ServiceEnv {
	const publicEnv: Record<string, string> = {}

	if (backing.hasD1) {
		publicEnv['D1_DATABASE_ID'] = requireScalar(
			outputs.d1DatabaseId,
			'd1_database_id',
		)
	}
	for (const alias of backing.kvAliases) {
		publicEnv[`KV_NAMESPACE_${envKeyFor(alias)}_ID`] = requireEntry(
			outputs.kvNamespaceIds,
			alias,
			'kv_namespace_ids',
		)
	}
	for (const alias of backing.queueAliases) {
		publicEnv[`QUEUE_${envKeyFor(alias)}_ID`] = requireEntry(
			outputs.queueIds,
			alias,
			'queue_ids',
		)
	}
	for (const alias of backing.bucketAliases) {
		publicEnv[`R2_BUCKET_${envKeyFor(alias)}`] = requireEntry(
			outputs.r2Buckets,
			alias,
			'r2_buckets',
		)
	}
	for (const alias of backing.cdnBucketAliases) {
		publicEnv[`R2_BUCKET_${envKeyFor(alias)}_URL`] = requireEntry(
			outputs.r2CdnUrls,
			alias,
			'r2_cdn_urls',
		)
	}
	if (backing.bucketAliases.length > 0) {
		publicEnv['R2_ENDPOINT'] = computeR2Endpoint(accountId)
	}

	return { public: publicEnv, secret: {} }
}
