import { pipe, transform } from 'valibot'

import { runSchema } from '../valibot.ts'

import { namedEntriesSchema } from './named-entries.ts'

import type {
	QueueConfig,
	QueuesServiceConfig,
} from '#/config/service-config.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

// `[[services.queues]]` is a table array directly under `services`, so TOML
// parses it to the array itself rather than to a `{ queues }` table.
const queuesSchema = pipe(
	namedEntriesSchema<QueueConfig>({
		path: 'services.queues',
		notArrayMessage: '[[services.queues]] must be an array of queue tables',
		emptyMessage: '[[services.queues]] must declare at least one queue',
		toEntry: name => ({ ok: true, entry: { name } }),
	}),
	transform((queues): QueuesServiceConfig => ({ queues })),
)

export function validateQueuesService(
	raw: unknown,
): ValidationResult<QueuesServiceConfig> {
	return runSchema(queuesSchema, raw)
}
