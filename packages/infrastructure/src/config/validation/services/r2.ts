import { KEBAB_IDENTIFIER_PATTERN } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import { array, minLength, object, pipe, rawTransform, unknown } from 'valibot'

import { runSchema } from '../valibot.ts'

import type {
	R2BucketConfig,
	R2ServiceConfig,
} from '#/config/service-config.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

// One error per bucket entry, first-match-wins (table -> name present -> kebab
// -> duplicate -> cdn boolean), plus dedup on the accepted names. A plain
// `array(pipe(...))` would emit multiple issues per entry under
// abortPipeEarly:false, so the per-entry checks live in a single rawTransform.
// Any `addIssue` marks the parse failed, so the returned buckets are discarded
// on error - no need to guard the return value.
const bucketsSchema = pipe(
	array(unknown(), 'services.r2.buckets must be an array of bucket tables'),
	minLength(1, 'services.r2.buckets must declare at least one bucket'),
	rawTransform<unknown[], R2BucketConfig[]>(({ dataset, addIssue }) => {
		const seen = new Set<string>()
		const buckets: R2BucketConfig[] = []

		for (const entry of dataset.value) {
			if (!isRecord(entry)) {
				addIssue({
					message:
						'services.r2.buckets entries must be tables with a `name` field',
				})
				continue
			}
			const { name } = entry
			if (typeof name !== 'string' || name === '') {
				addIssue({
					message:
						'services.r2.buckets entries must declare a non-empty string `name`',
				})
				continue
			}
			if (!KEBAB_IDENTIFIER_PATTERN.test(name)) {
				addIssue({
					message: `services.r2.buckets entry "${name}" must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
				})
				continue
			}
			if (seen.has(name)) {
				addIssue({
					message: `services.r2.buckets entry "${name}" is duplicated`,
				})
				continue
			}
			const { cdn } = entry
			if (typeof cdn !== 'undefined' && typeof cdn !== 'boolean') {
				addIssue({
					message: `services.r2.buckets entry "${name}" \`cdn\` must be a boolean`,
				})
				continue
			}
			seen.add(name)
			buckets.push({ name, cdn: cdn ?? false })
		}

		return buckets
	}),
)

const r2Schema = object(
	{
		buckets: bucketsSchema,
	},
	'[services.r2] must be a table',
)

export function validateR2Service(
	raw: unknown,
): ValidationResult<R2ServiceConfig> {
	return runSchema(r2Schema, raw)
}
