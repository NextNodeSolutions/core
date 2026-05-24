import type { PostgresMode, PostgresServiceConfig } from '#/config/types.ts'
import { POSTGRES_MODES, isPostgresMode, isRecord } from '#/config/types.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

export function validatePostgresService(
	raw: unknown,
): ValidationResult<PostgresServiceConfig> {
	if (!isRecord(raw)) {
		return { ok: false, errors: ['[services.postgres] must be a table'] }
	}

	const modeResult = validateMode(raw['mode'])
	const migrationsFolderResult = validateMigrationsFolder(
		raw['migrations_folder'],
	)
	const migrateCommandResult = validateMigrateCommand(raw['migrate_command'])

	if (
		!modeResult.ok ||
		!migrationsFolderResult.ok ||
		!migrateCommandResult.ok
	) {
		return {
			ok: false,
			errors: [
				modeResult,
				migrationsFolderResult,
				migrateCommandResult,
			].flatMap(r => (r.ok ? [] : r.errors)),
		}
	}

	return {
		ok: true,
		section: {
			mode: modeResult.section,
			migrationsFolder: migrationsFolderResult.section,
			migrateCommand: migrateCommandResult.section,
		},
	}
}

function validateMode(raw: unknown): ValidationResult<PostgresMode> {
	if (!isPostgresMode(raw)) {
		return {
			ok: false,
			errors: [
				`services.postgres.mode must be one of: ${POSTGRES_MODES.join(', ')}`,
			],
		}
	}
	return { ok: true, section: raw }
}

function validateMigrationsFolder(
	raw: unknown,
): ValidationResult<string | undefined> {
	if (raw === undefined) return { ok: true, section: undefined }
	if (typeof raw !== 'string' || raw === '') {
		return {
			ok: false,
			errors: [
				'services.postgres.migrations_folder must be a non-empty string when set',
			],
		}
	}
	return { ok: true, section: raw }
}

function validateMigrateCommand(
	raw: unknown,
): ValidationResult<string | undefined> {
	if (raw === undefined) return { ok: true, section: undefined }
	if (typeof raw !== 'string' || raw === '') {
		return {
			ok: false,
			errors: [
				'services.postgres.migrate_command must be a non-empty string when set',
			],
		}
	}
	return { ok: true, section: raw }
}
