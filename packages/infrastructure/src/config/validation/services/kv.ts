import { object } from 'valibot'

import { runSchema } from '../valibot.ts'

import { namedEntriesSchema } from './named-entries.ts'

import type {
	KvNamespaceConfig,
	KvServiceConfig,
} from '#/config/service-config.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

const kvSchema = object(
	{
		namespaces: namedEntriesSchema<KvNamespaceConfig>({
			path: 'services.kv.namespaces',
			notArrayMessage:
				'services.kv.namespaces must be an array of namespace tables',
			emptyMessage:
				'services.kv.namespaces must declare at least one namespace',
			toEntry: name => ({ ok: true, entry: { name } }),
		}),
	},
	'[services.kv] must be a table',
)

export function validateKvService(
	raw: unknown,
): ValidationResult<KvServiceConfig> {
	return runSchema(kvSchema, raw)
}
