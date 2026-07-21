import { R2_BUCKET_LOCATION_HINT } from '#/config/types.ts'
import { computeR2CustomDomainHostname } from '#/domain/cloudflare/r2/custom-domain.ts'
import { resolveDeployDomain } from '#/domain/deploy/domain.ts'
import {
	computeR2BucketName,
	computeR2ServiceBuckets,
} from '#/domain/services/r2.ts'

import {
	indexBy,
	redirectZoneLabel,
	toTerraformLabel,
} from './terraform-labels.ts'
import { buildRedirectResources } from './terraform-redirects.ts'

import type { R2BucketConfig } from '#/config/service-config.ts'
import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type {
	D1DatabaseResource,
	KvNamespaceResource,
	QueueResource,
	R2BucketResource,
	R2CustomDomainResource,
	TerraformResourceDraft,
	ZoneDataSource,
} from './terraform-main-config.ts'

// account_id is injected at apply time as TF_VAR_account_id (the adapter knows
// the account id from the env; the pure config never does), so every
// account-scoped resource references this Terraform variable rather than a
// literal.
export const ACCOUNT_ID_REF = '${var.account_id}'
const MAIN_ZONE_LABEL = 'zone_main'
const MAIN_ZONE_ID_REF = '${data.cloudflare_zone.zone_main.id}'

export interface WorkersDerivedResources {
	readonly projectName: string
	readonly domain: string
	readonly environment: AppEnvironment
	readonly resolvedDomain: string
	readonly buckets: ReadonlyArray<R2BucketConfig>
	readonly cdnBuckets: ReadonlyArray<R2BucketConfig>
	readonly kvNames: ReadonlyArray<string>
	readonly queueNames: ReadonlyArray<string>
	readonly hasD1: boolean
	readonly redirectDomains: ReadonlyArray<string>
	readonly hasAccountResource: boolean
}

export function deriveWorkersResources(
	config: CloudflareWorkersDeployableConfig,
	environment: AppEnvironment,
): WorkersDerivedResources {
	const { name: projectName, domain } = config.project
	const buckets = computeR2ServiceBuckets(config.services)
	const kvNames = (config.services.kv?.namespaces ?? []).map(
		namespace => namespace.name,
	)
	const queueNames = (config.services.queues?.queues ?? []).map(
		queue => queue.name,
	)
	const hasD1 = config.services.d1 !== undefined

	return {
		projectName,
		domain,
		environment,
		resolvedDomain: resolveDeployDomain(domain, environment),
		buckets,
		cdnBuckets: buckets.filter(bucket => bucket.cdn),
		kvNames,
		queueNames,
		hasD1,
		// Redirect Rules materialise the apex+www .fr -> .com concept, which only
		// exists in production; a dev zone has no record to redirect, so both the
		// rulesets and their support records (and their redirect zone lookups) are
		// omitted in development.
		redirectDomains:
			environment === 'production' ? config.project.redirectDomains : [],
		hasAccountResource:
			hasD1 ||
			kvNames.length > 0 ||
			queueNames.length > 0 ||
			buckets.length > 0,
	}
}

export function buildZoneData(
	derived: WorkersDerivedResources,
): Record<string, ZoneDataSource> {
	const zones: Record<string, ZoneDataSource> = {
		[MAIN_ZONE_LABEL]: { filter: { name: derived.domain } },
	}
	for (const redirectDomain of derived.redirectDomains) {
		zones[redirectZoneLabel(redirectDomain)] = {
			filter: { name: redirectDomain },
		}
	}
	return zones
}

function d1Resources(
	derived: WorkersDerivedResources,
): Record<string, D1DatabaseResource> {
	return {
		d1: {
			account_id: ACCOUNT_ID_REF,
			name: `${derived.projectName}-${derived.environment}-d1`,
		},
	}
}

function kvResources(
	derived: WorkersDerivedResources,
): Record<string, KvNamespaceResource> {
	return indexBy(derived.kvNames, name => [
		`kv_${toTerraformLabel(name)}`,
		{
			account_id: ACCOUNT_ID_REF,
			title: `${derived.projectName}-${derived.environment}-${name}`,
		},
	])
}

function queueResources(
	derived: WorkersDerivedResources,
): Record<string, QueueResource> {
	return indexBy(derived.queueNames, name => [
		`queue_${toTerraformLabel(name)}`,
		{
			account_id: ACCOUNT_ID_REF,
			queue_name: `${derived.projectName}-${derived.environment}-${name}`,
		},
	])
}

function r2BucketResources(
	derived: WorkersDerivedResources,
): Record<string, R2BucketResource> {
	return indexBy(
		derived.buckets.map(bucket => bucket.name),
		name => [
			`r2_${toTerraformLabel(name)}`,
			{
				account_id: ACCOUNT_ID_REF,
				name: computeR2BucketName(
					derived.projectName,
					derived.environment,
					name,
				),
				location: R2_BUCKET_LOCATION_HINT,
			},
		],
	)
}

function r2CustomDomainResources(
	derived: WorkersDerivedResources,
): Record<string, R2CustomDomainResource> {
	return indexBy(
		derived.cdnBuckets.map(bucket => bucket.name),
		name => [
			`r2_${toTerraformLabel(name)}_cdn`,
			{
				account_id: ACCOUNT_ID_REF,
				bucket_name: computeR2BucketName(
					derived.projectName,
					derived.environment,
					name,
				),
				domain: computeR2CustomDomainHostname(
					name,
					derived.resolvedDomain,
				),
				zone_id: MAIN_ZONE_ID_REF,
				enabled: true,
			},
		],
	)
}

export function buildResourceBlock(
	derived: WorkersDerivedResources,
): TerraformResourceDraft {
	const resource: TerraformResourceDraft = {}
	if (derived.hasD1) {
		resource.cloudflare_d1_database = d1Resources(derived)
	}
	if (derived.kvNames.length > 0) {
		resource.cloudflare_workers_kv_namespace = kvResources(derived)
	}
	if (derived.queueNames.length > 0) {
		resource.cloudflare_queue = queueResources(derived)
	}
	if (derived.buckets.length > 0) {
		resource.cloudflare_r2_bucket = r2BucketResources(derived)
	}
	if (derived.cdnBuckets.length > 0) {
		resource.cloudflare_r2_custom_domain = r2CustomDomainResources(derived)
	}
	if (derived.redirectDomains.length > 0) {
		const { dns, rulesets } = buildRedirectResources(
			derived.domain,
			derived.environment,
			derived.resolvedDomain,
			derived.redirectDomains,
		)
		resource.cloudflare_dns_record = dns
		resource.cloudflare_ruleset = rulesets
	}
	return resource
}
