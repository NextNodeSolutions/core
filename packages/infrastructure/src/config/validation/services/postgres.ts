import { POSTGRES_MODES } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import { picklist } from 'valibot'

import { collectFieldErrors, optionalNonEmpty, runSchema } from '../valibot.ts'

import type { PostgresServiceConfig } from '#/config/types.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

const modeSchema = picklist(
	POSTGRES_MODES,
	`services.postgres.mode must be one of: ${POSTGRES_MODES.join(', ')}`,
)
const migrationsFolderSchema = optionalNonEmpty(
	'services.postgres.migrations_folder must be a non-empty string when set',
)
const migrateCommandSchema = optionalNonEmpty(
	'services.postgres.migrate_command must be a non-empty string when set',
)
const checkCommandSchema = optionalNonEmpty(
	'services.postgres.check_command must be a non-empty string when set',
)

export function validatePostgresService(
	raw: unknown,
): ValidationResult<PostgresServiceConfig> {
	if (!isRecord(raw)) {
		return { ok: false, errors: ['[services.postgres] must be a table'] }
	}

	// `mode` is required: validating the value directly (rather than as an
	// optional object entry) means a missing key reaches `picklist` as
	// `undefined` and fails with the real message - no "Invalid key" default,
	// no placeholder needed.
	const mode = runSchema(modeSchema, raw['mode'])
	const migrationsFolder = runSchema(
		migrationsFolderSchema,
		raw['migrations_folder'],
	)
	const migrateCommand = runSchema(
		migrateCommandSchema,
		raw['migrate_command'],
	)
	const checkCommand = runSchema(checkCommandSchema, raw['check_command'])

	if (
		!mode.ok ||
		!migrationsFolder.ok ||
		!migrateCommand.ok ||
		!checkCommand.ok
	) {
		return {
			ok: false,
			errors: collectFieldErrors(
				mode,
				migrationsFolder,
				migrateCommand,
				checkCommand,
			),
		}
	}

	return {
		ok: true,
		section: {
			mode: mode.section,
			...(migrationsFolder.section !== undefined && {
				migrationsFolder: migrationsFolder.section,
			}),
			...(migrateCommand.section !== undefined && {
				migrateCommand: migrateCommand.section,
			}),
			...(checkCommand.section !== undefined && {
				checkCommand: checkCommand.section,
			}),
		},
	}
}
