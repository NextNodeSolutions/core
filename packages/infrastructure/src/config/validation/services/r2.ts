import { object } from 'valibot'

import { runSchema } from '../valibot.ts'

import { namedEntriesSchema } from './named-entries.ts'

import type {
	R2BucketConfig,
	R2ServiceConfig,
} from '#/config/service-config.ts'
import type { ValidationResult } from '#/config/validation/result.ts'
import type { NamedEntryResult } from './named-entries.ts'

function toBucket(
	name: string,
	table: Record<string, unknown>,
): NamedEntryResult<R2BucketConfig> {
	const { cdn } = table
	if (typeof cdn === 'undefined' || typeof cdn === 'boolean') {
		return { ok: true, entry: { name, cdn: cdn ?? false } }
	}
	return {
		ok: false,
		message: `services.r2.buckets entry "${name}" \`cdn\` must be a boolean`,
	}
}

const r2Schema = object(
	{
		buckets: namedEntriesSchema({
			path: 'services.r2.buckets',
			notArrayMessage:
				'services.r2.buckets must be an array of bucket tables',
			emptyMessage:
				'services.r2.buckets must declare at least one bucket',
			toEntry: toBucket,
		}),
	},
	'[services.r2] must be a table',
)

export function validateR2Service(
	raw: unknown,
): ValidationResult<R2ServiceConfig> {
	return runSchema(r2Schema, raw)
}
