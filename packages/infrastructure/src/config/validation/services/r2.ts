import { KEBAB_IDENTIFIER_PATTERN } from '#/config/types.ts'
import { array, minLength, object, pipe, rawTransform, unknown } from 'valibot'

import { runSchema } from '../valibot.ts'

import type { R2ServiceConfig } from '#/config/types.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

// One error per bucket entry, first-match-wins (non-empty -> kebab -> duplicate),
// plus dedup on the accepted aliases. A plain `array(pipe(...))` would emit
// multiple issues per entry under abortPipeEarly:false, so the per-entry checks
// live in a single rawTransform that mirrors the hand-rolled loop exactly. Any
// `addIssue` marks the parse failed, so the returned aliases are discarded on
// error — no need to guard the return value.
const bucketsSchema = pipe(
	array(unknown(), 'services.r2.buckets must be an array of strings'),
	minLength(1, 'services.r2.buckets must declare at least one bucket alias'),
	rawTransform<unknown[], string[]>(({ dataset, addIssue }) => {
		const seen = new Set<string>()
		const aliases: string[] = []

		for (const entry of dataset.value) {
			if (typeof entry !== 'string' || entry === '') {
				addIssue({
					message:
						'services.r2.buckets entries must be non-empty strings',
				})
				continue
			}
			if (!KEBAB_IDENTIFIER_PATTERN.test(entry)) {
				addIssue({
					message: `services.r2.buckets entry "${entry}" must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
				})
				continue
			}
			if (seen.has(entry)) {
				addIssue({
					message: `services.r2.buckets entry "${entry}" is duplicated`,
				})
				continue
			}
			seen.add(entry)
			aliases.push(entry)
		}

		return aliases
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
