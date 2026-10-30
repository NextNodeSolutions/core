import { computeR2Endpoint } from '#/domain/cloudflare/r2/addressing.ts'
import { computeR2ServiceBuckets } from '#/domain/services/r2.ts'

import {
	PLANETSCALE_MIGRATOR_OUTPUT_PREFIX,
	PLANETSCALE_RUNTIME_OUTPUT_PREFIX,
} from './planetscale.ts'
import { ACCESS_AUDIENCES_OUTPUT } from './terraform-access.ts'
import {
	asString,
	extractValue,
	optionalStringMap,
} from './terraform-output-values.ts'
import {
	R2_S3_ACCESS_KEY_ID_OUTPUT,
	R2_S3_SECRET_ACCESS_KEY_OUTPUT,
} from './terraform-r2-credentials.ts'

import type { ServicesConfig } from '#/config/service-config.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'
import type { PlanetscaleRoleCredentials } from './planetscale.ts'
import type { R2S3Credentials } from './terraform-r2-credentials.ts'

/**
 * The Terraform outputs the cloudflare-workers `main.tf.json` emits, narrowed
 * from the raw `terraform output -json` envelope (`{<name>: {value: ...}}`).
 * Only backing services that exist in the config produce an output, so every
 * field is present-or-empty: a project with no D1 has no `d1DatabaseId`, a
 * project with no KV has an empty `kvNamespaceIds` map. Keys are the dev's
 * declared aliases; values are the ids/URLs Terraform computed.
 */
export interface WorkersTerraformOutputs {
	readonly planetscaleMigrator?: PlanetscaleRoleCredentials
	// The runtime role, emitted only when a container service needs PlanetScale:
	// a container has no Hyperdrive binding and connects with a URL instead.
	readonly planetscaleRuntime?: PlanetscaleRoleCredentials
	// The S3 key pair of the project's R2 token, emitted only when a container
	// service needs r2: a Worker reaches its buckets through bindings.
	readonly r2S3Credentials?: R2S3Credentials
	readonly d1DatabaseId?: string
	// The `cloudflare_hyperdrive_config` id - consumed by the `hyperdrive` wrangler
	// binding, never projected as an env var (the Worker reaches Postgres through
	// the binding, not a string). Present only when [services.planetscale] exists.
	readonly hyperdriveConfigId?: string
	readonly kvNamespaceIds: Readonly<Record<string, string>>
	readonly queueIds: Readonly<Record<string, string>>
	readonly r2Buckets: Readonly<Record<string, string>>
	readonly r2CdnUrls: Readonly<Record<string, string>>
	// Audience tag of each internal service's Access application, by service name.
	readonly accessAudiences: Readonly<Record<string, string>>
}

// The outputs of a project with no backing resources: nothing was applied, so
// every map is empty. Used to skip a Terraform round-trip when nothing is
// declared, instead of reading outputs that would all be absent.
export const EMPTY_WORKERS_TERRAFORM_OUTPUTS: WorkersTerraformOutputs = {
	kvNamespaceIds: {},
	queueIds: {},
	r2Buckets: {},
	r2CdnUrls: {},
	accessAudiences: {},
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

// The value every backing output carries when outputs stand in for type
// generation. Never a real id: types are generated BEFORE provision (at
// typecheck time), when no Terraform output exists, and the type generator reads
// only the binding/var NAMES the config-driven builders produce - the values are
// discarded. A recognisable sentinel makes an accidental deploy-time use obvious.
const TYPES_PLACEHOLDER_OUTPUT = 'types-only-placeholder'

/**
 * Synthesise the Terraform outputs a project WOULD emit, one placeholder id per
 * declared backing alias, so `buildWranglerConfig`/`buildWorkerVars` (which fail
 * loud on a missing provision output) run before provision to drive type
 * generation. Only the resulting binding + var NAMES are read; the placeholder
 * values never reach a deploy. Deriving types from the SAME builders this feeds
 * is what keeps the generated `Env` and the deployed wrangler config from
 * drifting.
 */
export function typesPlaceholderOutputs(
	backing: WorkersBackingConfig,
	internalServiceNames: ReadonlyArray<string>,
): WorkersTerraformOutputs {
	const fill = (aliases: ReadonlyArray<string>): Record<string, string> =>
		Object.fromEntries(
			aliases.map(alias => [alias, TYPES_PLACEHOLDER_OUTPUT]),
		)
	return {
		kvNamespaceIds: fill(backing.kvAliases),
		queueIds: fill(backing.queueAliases),
		r2Buckets: fill(backing.bucketAliases),
		r2CdnUrls: fill(backing.cdnBucketAliases),
		accessAudiences: fill(internalServiceNames),
		...(backing.hasD1 && { d1DatabaseId: TYPES_PLACEHOLDER_OUTPUT }),
	}
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
	const audiences = extractValue(raw, ACCESS_AUDIENCES_OUTPUT)
	const outputs: WorkersTerraformOutputsDraft = {
		kvNamespaceIds: optionalStringMap(kv, 'kv_namespace_ids'),
		queueIds: optionalStringMap(queues, 'queue_ids'),
		r2Buckets: optionalStringMap(buckets, 'r2_buckets'),
		r2CdnUrls: optionalStringMap(cdn, 'r2_cdn_urls'),
		accessAudiences: optionalStringMap(audiences, ACCESS_AUDIENCES_OUTPUT),
	}
	if (typeof d1 !== 'undefined') {
		outputs.d1DatabaseId = asString(d1, 'd1_database_id')
	}
	if (typeof hyperdrive !== 'undefined') {
		outputs.hyperdriveConfigId = asString(
			hyperdrive,
			'hyperdrive_config_id',
		)
	}
	const migrator = parseRoleCredentials(
		raw,
		PLANETSCALE_MIGRATOR_OUTPUT_PREFIX,
	)
	if (migrator) outputs.planetscaleMigrator = migrator
	const runtime = parseRoleCredentials(raw, PLANETSCALE_RUNTIME_OUTPUT_PREFIX)
	if (runtime) outputs.planetscaleRuntime = runtime
	const r2S3 = parseR2S3Credentials(raw)
	if (r2S3) outputs.r2S3Credentials = r2S3
	return outputs
}

// The two R2 key outputs, absent together when no container needs r2.
function parseR2S3Credentials(
	raw: Readonly<Record<string, unknown>>,
): R2S3Credentials | undefined {
	const accessKeyId = extractValue(raw, R2_S3_ACCESS_KEY_ID_OUTPUT)
	if (typeof accessKeyId === 'undefined') return undefined
	return {
		accessKeyId: asString(accessKeyId, R2_S3_ACCESS_KEY_ID_OUTPUT),
		secretAccessKey: asString(
			extractValue(raw, R2_S3_SECRET_ACCESS_KEY_OUTPUT),
			R2_S3_SECRET_ACCESS_KEY_OUTPUT,
		),
	}
}

// The four `<prefix>_{host,database,user,password}` outputs of a branch role,
// absent together when the role is not exposed.
function parseRoleCredentials(
	raw: Readonly<Record<string, unknown>>,
	prefix: string,
): PlanetscaleRoleCredentials | undefined {
	const host = extractValue(raw, `${prefix}_host`)
	if (typeof host === 'undefined') return undefined
	const read = (field: string): string =>
		asString(extractValue(raw, `${prefix}_${field}`), `${prefix}_${field}`)
	return {
		host: asString(host, `${prefix}_host`),
		database: read('database'),
		user: read('user'),
		password: read('password'),
	}
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
