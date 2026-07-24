import { KEBAB_IDENTIFIER_PATTERN } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import { array, minLength, pipe, rawTransform, unknown } from 'valibot'

import { runSchema } from '../valibot.ts'

import type {
	QueueConfig,
	QueuesServiceConfig,
} from '#/config/service-config.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

// `[[services.queues]]` is a table-array directly under `services`, so smol-toml
// parses it to an array (not a `{ queues: [...] }` table). The rawTransform
// therefore receives the entries directly and folds them into the
// QueuesServiceConfig shape - same single-issue-per-entry pattern as
// services.r2.buckets (first-match-wins, dedup on accepted names).
const queuesSchema = pipe(
	array(unknown(), '[[services.queues]] must be an array of queue tables'),
	minLength(1, '[[services.queues]] must declare at least one queue'),
	rawTransform<unknown[], QueuesServiceConfig>(({ dataset, addIssue }) => {
		const seen = new Set<string>()
		const queues: QueueConfig[] = []

		for (const entry of dataset.value) {
			if (!isRecord(entry)) {
				addIssue({
					message:
						'services.queues entries must be tables with a `name` field',
				})
				continue
			}
			const { name } = entry
			if (typeof name !== 'string' || name === '') {
				addIssue({
					message:
						'services.queues entries must declare a non-empty string `name`',
				})
				continue
			}
			if (!KEBAB_IDENTIFIER_PATTERN.test(name)) {
				addIssue({
					message: `services.queues entry "${name}" must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
				})
				continue
			}
			if (seen.has(name)) {
				addIssue({
					message: `services.queues entry "${name}" is duplicated`,
				})
				continue
			}
			seen.add(name)
			queues.push({ name })
		}

		return { queues }
	}),
)

export function validateQueuesService(
	raw: unknown,
): ValidationResult<QueuesServiceConfig> {
	return runSchema(queuesSchema, raw)
}
