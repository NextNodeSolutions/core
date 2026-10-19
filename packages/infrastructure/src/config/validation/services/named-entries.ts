import { KEBAB_IDENTIFIER_PATTERN } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import { array, minLength, pipe, rawTransform, unknown } from 'valibot'

import type { GenericSchema } from 'valibot'

export type NamedEntryResult<T> =
	| { readonly ok: true; readonly entry: T }
	| { readonly ok: false; readonly message: string }

interface NamedEntriesRules<T> {
	readonly path: string
	readonly notArrayMessage: string
	readonly emptyMessage: string
	readonly toEntry: (
		name: string,
		table: Record<string, unknown>,
	) => NamedEntryResult<T>
}

// One rawTransform reports one issue per entry, where `array(pipe(...))` would
// report several under abortPipeEarly: false.
export function namedEntriesSchema<T>(
	rules: NamedEntriesRules<T>,
): GenericSchema<unknown, T[]> {
	return pipe(
		array(unknown(), rules.notArrayMessage),
		minLength(1, rules.emptyMessage),
		rawTransform<unknown[], T[]>(({ dataset, addIssue }) => {
			const seen = new Set<string>()
			const entries: T[] = []

			for (const table of dataset.value) {
				if (!isRecord(table)) {
					addIssue({
						message: `${rules.path} entries must be tables with a \`name\` field`,
					})
					continue
				}
				const { name } = table
				if (typeof name !== 'string' || name === '') {
					addIssue({
						message: `${rules.path} entries must declare a non-empty string \`name\``,
					})
					continue
				}
				if (!KEBAB_IDENTIFIER_PATTERN.test(name)) {
					addIssue({
						message: `${rules.path} entry "${name}" must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
					})
					continue
				}
				if (seen.has(name)) {
					addIssue({
						message: `${rules.path} entry "${name}" is duplicated`,
					})
					continue
				}
				const parsedEntry = rules.toEntry(name, table)
				if (!parsedEntry.ok) {
					addIssue({ message: parsedEntry.message })
					continue
				}
				seen.add(name)
				entries.push(parsedEntry.entry)
			}

			return entries
		}),
	)
}
