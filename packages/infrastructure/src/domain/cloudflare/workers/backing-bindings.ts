import {
	toBindingName,
	WORKERS_D1_BINDING,
	WORKERS_HYPERDRIVE_BINDING,
} from './wrangler-document.ts'

import type { WorkersBackingConfig } from './outputs-env.ts'
import type { WranglerConfigInput } from './wrangler-config-input.ts'
import type {
	WranglerD1Database,
	WranglerHyperdrive,
	WranglerKvNamespace,
	WranglerQueueProducer,
	WranglerR2Bucket,
} from './wrangler-document.ts'

function requireOutput(emitted: string | undefined, what: string): string {
	if (typeof emitted === 'undefined') {
		throw new Error(
			`${what} is missing from the provision outputs but a service declares it in \`needs\` - run \`infrastructure provision\` before deploy so Terraform creates the resource and emits its output.`,
		)
	}
	return emitted
}

export function d1Databases(
	input: WranglerConfigInput,
): ReadonlyArray<WranglerD1Database> | undefined {
	const { d1 } = input.services
	if (!d1 || !input.service.needs.includes('d1')) return undefined
	const database: WranglerD1DatabaseDraft = {
		binding: WORKERS_D1_BINDING,
		database_name: `${input.projectName}-${input.environment}-d1`,
		database_id: requireOutput(
			input.outputs.d1DatabaseId,
			'd1_database_id',
		),
	}
	if (typeof d1.migrationsFolder !== 'undefined') {
		database.migrations_dir = d1.migrationsFolder
	}
	return [database]
}

type WranglerD1DatabaseDraft = {
	-readonly [K in keyof WranglerD1Database]: WranglerD1Database[K]
}

export function hyperdrive(
	input: WranglerConfigInput,
): ReadonlyArray<WranglerHyperdrive> | undefined {
	if (
		!input.services.planetscale ||
		!input.service.needs.includes('planetscale')
	) {
		return undefined
	}
	return [
		{
			binding: WORKERS_HYPERDRIVE_BINDING,
			id: requireOutput(
				input.outputs.hyperdriveConfigId,
				'hyperdrive_config_id',
			),
		},
	]
}

export function kvNamespaces(
	input: WranglerConfigInput,
	backing: WorkersBackingConfig,
): ReadonlyArray<WranglerKvNamespace> | undefined {
	if (!input.service.needs.includes('kv') || !backing.kvAliases.length) {
		return undefined
	}
	return backing.kvAliases.map(alias => ({
		binding: `KV_${toBindingName(alias)}`,
		id: requireOutput(
			input.outputs.kvNamespaceIds[alias],
			`kv_namespace_ids["${alias}"]`,
		),
	}))
}

export function r2Buckets(
	input: WranglerConfigInput,
	backing: WorkersBackingConfig,
): ReadonlyArray<WranglerR2Bucket> | undefined {
	if (!input.service.needs.includes('r2') || !backing.bucketAliases.length) {
		return undefined
	}
	return backing.bucketAliases.map(alias => ({
		binding: `R2_${toBindingName(alias)}`,
		bucket_name: requireOutput(
			input.outputs.r2Buckets[alias],
			`r2_buckets["${alias}"]`,
		),
	}))
}

export function queueProducers(
	input: WranglerConfigInput,
	backing: WorkersBackingConfig,
): ReadonlyArray<WranglerQueueProducer> | undefined {
	if (
		!input.service.needs.includes('queues') ||
		!backing.queueAliases.length
	) {
		return undefined
	}
	// The queue producer binds to the queue NAME (materialised the same way
	// Terraform named it); the provision outputs carry ids, not names.
	return backing.queueAliases.map(alias => ({
		binding: `QUEUE_${toBindingName(alias)}`,
		queue: `${input.projectName}-${input.environment}-${alias}`,
	}))
}
