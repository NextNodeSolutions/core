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

	if (!modeResult.ok || !versionResult.ok) {
		return {
			ok: false,
			errors: [modeResult, versionResult].flatMap(r =>
				r.ok ? [] : r.errors,
			),
		}
	}

	return {
		ok: true,
		section: {
			mode: modeResult.section,
			version: versionResult.section,
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
