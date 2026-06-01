import { DEFAULT_ENVIRONMENT, DEFAULT_SCRIPTS } from '#/config/types.ts'
import { boolean, object, optional } from 'valibot'

import { optionalStringOrFalse, runSchema } from './valibot.ts'

import type { EnvironmentSection, ScriptsSection } from '#/config/types.ts'
import type { GenericSchema } from 'valibot'
import type { ValidationResult } from './result.ts'

const scriptField = (
	key: keyof ScriptsSection,
): GenericSchema<unknown, string | false> =>
	optionalStringOrFalse(
		issue =>
			`scripts.${key} must be a string or false, got ${typeof issue.input}`,
		DEFAULT_SCRIPTS[key],
	)

const scriptsSchema = optional(
	object(
		{
			lint: scriptField('lint'),
			test: scriptField('test'),
			build: scriptField('build'),
		},
		'[scripts] must be a table',
	),
	DEFAULT_SCRIPTS,
)

const environmentSchema = optional(
	object(
		{
			development: optional(
				boolean('environment.development must be a boolean'),
				DEFAULT_ENVIRONMENT.development,
			),
		},
		'[environment] must be a table',
	),
	DEFAULT_ENVIRONMENT,
)

export function validateScriptsSection(
	raw: unknown,
): ValidationResult<ScriptsSection> {
	return runSchema(scriptsSchema, raw)
}

export function validateEnvironmentSection(
	raw: unknown,
): ValidationResult<EnvironmentSection> {
	return runSchema(environmentSchema, raw)
}
