import type { PostgresMode, PostgresServiceConfig } from '#/config/types.ts'
import {
	POSTGRES_MODES,
	POSTGRES_VERSION_PATTERN,
	isPostgresMode,
	isRecord,
} from '#/config/types.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

export function validatePostgresService(
	raw: unknown,
): ValidationResult<PostgresServiceConfig> {
	if (!isRecord(raw)) {
		return { ok: false, errors: ['[services.postgres] must be a table'] }
	}

	const modeResult = validateMode(raw['mode'])
	const versionResult = validateVersion(raw['version'])
	const migrationsFolderResult = validateMigrationsFolder(
		raw['migrations_folder'],
	)

	if (!modeResult.ok || !versionResult.ok || !migrationsFolderResult.ok) {
		return {
			ok: false,
			errors: [modeResult, versionResult, migrationsFolderResult].flatMap(
				r => (r.ok ? [] : r.errors),
			),
		}
	}

	return {
		ok: true,
		section: {
			mode: modeResult.section,
			version: versionResult.section,
			migrationsFolder: migrationsFolderResult.section,
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

function validateVersion(raw: unknown): ValidationResult<string> {
	if (typeof raw !== 'string' || raw === '') {
		return {
			ok: false,
			errors: ['services.postgres.version must be a non-empty string'],
		}
	}
	if (!POSTGRES_VERSION_PATTERN.test(raw)) {
		return {
			ok: false,
			errors: [
				`services.postgres.version "${raw}" must match pattern ${POSTGRES_VERSION_PATTERN.source} (e.g. "16" or "17.2")`,
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
