import {
	computeR2CustomDomainHostname,
	computeR2PublicUrl,
} from '#/domain/cloudflare/r2/custom-domain.ts'

import {
	PLANETSCALE_MIGRATOR_OUTPUT_PREFIX,
	PLANETSCALE_RUNTIME_OUTPUT_PREFIX,
} from './planetscale.ts'
import { indexBy, r2BucketLabel, toTerraformLabel } from './terraform-labels.ts'
import {
	PLANETSCALE_MIGRATOR_REF,
	PLANETSCALE_RUNTIME_REF,
} from './terraform-planetscale-resources.ts'

import type { OutputValue } from './terraform-main-config.ts'
import type { WorkersDerivedResources } from './terraform-resources.ts'

function kvNamespaceIdsOutput(derived: WorkersDerivedResources): OutputValue {
	return {
		value: indexBy(derived.kvNames, name => [
			name,
			`\${cloudflare_workers_kv_namespace.kv_${toTerraformLabel(name)}.id}`,
		]),
	}
}

function queueIdsOutput(derived: WorkersDerivedResources): OutputValue {
	return {
		value: indexBy(derived.queueNames, name => [
			name,
			`\${cloudflare_queue.queue_${toTerraformLabel(name)}.id}`,
		]),
	}
}

function r2BucketsOutput(derived: WorkersDerivedResources): OutputValue {
	return {
		value: indexBy(
			derived.buckets.map(bucket => bucket.name),
			name => [
				name,
				`\${cloudflare_r2_bucket.${r2BucketLabel(name)}.id}`,
			],
		),
	}
}

function r2CdnUrlsOutput(derived: WorkersDerivedResources): OutputValue {
	return {
		value: indexBy(
			derived.cdnBuckets.map(bucket => bucket.name),
			name => [
				name,
				computeR2PublicUrl(
					computeR2CustomDomainHostname(name, derived.resolvedDomain),
				),
			],
		),
	}
}

// The branch-role attributes behind each `<prefix>_<name>` credential output.
const ROLE_CREDENTIAL_ATTRIBUTES = {
	host: 'access_host_url',
	database: 'database_name',
	user: 'username',
	password: 'password',
} as const

function roleCredentialOutputs(
	prefix: string,
	roleRef: string,
): Record<string, OutputValue> {
	return Object.fromEntries(
		Object.entries(ROLE_CREDENTIAL_ATTRIBUTES).map(([name, attribute]) => [
			`${prefix}_${name}`,
			{ value: `\${${roleRef}.${attribute}}`, sensitive: true },
		]),
	)
}

export function buildOutputs(
	derived: WorkersDerivedResources,
): Record<string, OutputValue> {
	const output: Record<string, OutputValue> = {}
	if (derived.hasD1) {
		output['d1_database_id'] = { value: '${cloudflare_d1_database.d1.id}' }
	}
	if (derived.hasPlanetscale) {
		Object.assign(
			output,
			roleCredentialOutputs(
				PLANETSCALE_MIGRATOR_OUTPUT_PREFIX,
				PLANETSCALE_MIGRATOR_REF,
			),
		)
		output['hyperdrive_config_id'] = {
			value: '${cloudflare_hyperdrive_config.planetscale.id}',
		}
	}
	// A container connects with a URL, so the runtime role's credentials leave
	// Terraform only when a container service connects as that role.
	if (derived.hasPlanetscaleRuntimeContainer) {
		Object.assign(
			output,
			roleCredentialOutputs(
				PLANETSCALE_RUNTIME_OUTPUT_PREFIX,
				PLANETSCALE_RUNTIME_REF,
			),
		)
	}
	if (derived.kvNames.length > 0) {
		output['kv_namespace_ids'] = kvNamespaceIdsOutput(derived)
	}
	if (derived.queueNames.length > 0) {
		output['queue_ids'] = queueIdsOutput(derived)
	}
	if (derived.buckets.length > 0) {
		output['r2_buckets'] = r2BucketsOutput(derived)
	}
	if (derived.cdnBuckets.length > 0) {
		output['r2_cdn_urls'] = r2CdnUrlsOutput(derived)
	}
	return output
}
