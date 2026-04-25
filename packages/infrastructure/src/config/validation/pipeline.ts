import type { EnvironmentSection, ScriptsSection } from '@/config/types.ts'
import {
	DEFAULT_ENVIRONMENT,
	DEFAULT_SCRIPTS,
	isBoolean,
	isRecord,
	isScriptValue,
} from '@/config/types.ts'

import type { ValidationResult } from './result.ts'

export function validateScriptsSection(
	raw: unknown,
): ValidationResult<ScriptsSection> {
	if (raw !== undefined && !isRecord(raw)) {
		return { ok: false, errors: ['[scripts] must be a table'] }
	}

	const values = isRecord(raw) ? raw : {}
	const errors: string[] = []

	for (const key of ['lint', 'test', 'build'] as const) {
		const value = values[key]
		if (value !== undefined && !isScriptValue(value)) {
			errors.push(
				`scripts.${key} must be a string or false, got ${typeof value}`,
			)
		}
	}

	if (errors.length > 0) return { ok: false, errors }

	return {
		ok: true,
		section: {
			lint: isScriptValue(values['lint'])
				? values['lint']
				: DEFAULT_SCRIPTS.lint,
			test: isScriptValue(values['test'])
				? values['test']
				: DEFAULT_SCRIPTS.test,
			build: isScriptValue(values['build'])
				? values['build']
				: DEFAULT_SCRIPTS.build,
		},
	}
}

export function validateEnvironmentSection(
	raw: unknown,
): ValidationResult<EnvironmentSection> {
	if (raw !== undefined && !isRecord(raw)) {
		return { ok: false, errors: ['[environment] must be a table'] }
	}

	const raw_development = isRecord(raw) ? raw['development'] : undefined

	if (raw_development !== undefined && !isBoolean(raw_development)) {
		return {
			ok: false,
			errors: ['environment.development must be a boolean'],
		}
	}

	return {
		ok: true,
		section: {
			development: raw_development ?? DEFAULT_ENVIRONMENT.development,
		},
	}
}
