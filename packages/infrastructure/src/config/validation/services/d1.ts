import { DEFAULT_MIGRATIONS_FOLDER } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import { optional } from 'valibot'

import {
	collectFieldErrors,
	nonEmptyString,
	optionalNonEmpty,
	runSchema,
} from '../valibot.ts'

import type { D1ServiceConfig } from '#/config/types.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

const migrationsFolderSchema = optional(
	nonEmptyString(
		'services.d1.migrations_folder must be a non-empty string when set',
	),
	DEFAULT_MIGRATIONS_FOLDER,
)
const checkCommandSchema = optionalNonEmpty(
	'services.d1.check_command must be a non-empty string when set',
)

export function validateD1Service(
	raw: unknown,
): ValidationResult<D1ServiceConfig> {
	if (!isRecord(raw)) {
		return { ok: false, errors: ['[services.d1] must be a table'] }
	}

	const migrationsFolder = runSchema(
		migrationsFolderSchema,
		raw['migrations_folder'],
	)
	const checkCommand = runSchema(checkCommandSchema, raw['check_command'])

	if (!migrationsFolder.ok || !checkCommand.ok) {
		return {
			ok: false,
			errors: collectFieldErrors(migrationsFolder, checkCommand),
		}
	}

	return {
		ok: true,
		section: {
			migrationsFolder: migrationsFolder.section,
			...(typeof checkCommand.section !== 'undefined' && {
				checkCommand: checkCommand.section,
			}),
		},
	}
}
