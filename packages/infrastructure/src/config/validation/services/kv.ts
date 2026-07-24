import { KEBAB_IDENTIFIER_PATTERN } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import { array, minLength, object, pipe, rawTransform, unknown } from 'valibot'

import { runSchema } from '../valibot.ts'

import type {
	KvNamespaceConfig,
	KvServiceConfig,
} from '#/config/service-config.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

// One error per namespace entry, first-match-wins (table -> name present ->
// kebab -> duplicate), plus dedup on the accepted names. Same single-issue
// rawTransform shape as services.r2.buckets: a plain `array(pipe(...))` would
// emit multiple issues per entry under abortPipeEarly:false.
const namespacesSchema = pipe(
	array(
		unknown(),
		'services.kv.namespaces must be an array of namespace tables',
	),
	minLength(1, 'services.kv.namespaces must declare at least one namespace'),
	rawTransform<unknown[], KvNamespaceConfig[]>(({ dataset, addIssue }) => {
		const seen = new Set<string>()
		const namespaces: KvNamespaceConfig[] = []

		for (const entry of dataset.value) {
			if (!isRecord(entry)) {
				addIssue({
					message:
						'services.kv.namespaces entries must be tables with a `name` field',
				})
				continue
			}
			const { name } = entry
			if (typeof name !== 'string' || name === '') {
				addIssue({
					message:
						'services.kv.namespaces entries must declare a non-empty string `name`',
				})
				continue
			}
			if (!KEBAB_IDENTIFIER_PATTERN.test(name)) {
				addIssue({
					message: `services.kv.namespaces entry "${name}" must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
				})
				continue
			}
			if (seen.has(name)) {
				addIssue({
					message: `services.kv.namespaces entry "${name}" is duplicated`,
				})
				continue
			}
			seen.add(name)
			namespaces.push({ name })
		}

		return namespaces
	}),
)

const kvSchema = object(
	{
		namespaces: namespacesSchema,
	},
	'[services.kv] must be a table',
)

export function validateKvService(
	raw: unknown,
): ValidationResult<KvServiceConfig> {
	return runSchema(kvSchema, raw)
}
