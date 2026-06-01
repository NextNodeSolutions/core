import { KEBAB_IDENTIFIER_PATTERN, PROJECT_TYPES } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import { array, boolean, optional, picklist, pipe, regex } from 'valibot'

import {
	collectFieldErrors,
	nonEmptyString,
	optionalNonEmpty,
	optionalStringOrFalse,
	runSchema,
} from './valibot.ts'

import type { PackageSection, ProjectSection } from '#/config/types.ts'
import type { ValidationResult } from './result.ts'

const NAME_MSG = 'project.name is required and must be a string'
const NAME_PATTERN_MSG = `project.name must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`
const TYPE_MSG = `project.type is required and must be one of: ${PROJECT_TYPES.join(', ')}`
const FILTER_MSG = 'project.filter must be a string or false'
const DOMAIN_MSG = 'project.domain must be a non-empty string'
const REDIRECT_NOT_ARRAY_MSG =
	'project.redirect_domains must be an array of strings'
const REDIRECT_ENTRY_MSG =
	'project.redirect_domains entries must be non-empty strings'
const INTERNAL_MSG = 'project.internal must be a boolean'

// Required: validating each value directly (not as an optional object entry)
// means a missing key arrives as `undefined` and fails with the real message,
// while the success branch yields a narrowed type — no placeholder fallback.
const nameSchema = pipe(
	nonEmptyString(NAME_MSG),
	regex(KEBAB_IDENTIFIER_PATTERN, NAME_PATTERN_MSG),
)
const typeSchema = picklist(PROJECT_TYPES, TYPE_MSG)
const filterSchema = optionalStringOrFalse(FILTER_MSG, false)
const domainSchema = optionalNonEmpty(DOMAIN_MSG)
const redirectDomainsSchema = optional(
	array(nonEmptyString(REDIRECT_ENTRY_MSG), REDIRECT_NOT_ARRAY_MSG),
	[],
)
const internalSchema = optional(boolean(INTERNAL_MSG), false)

export function validateProjectSection(
	raw: unknown,
): ValidationResult<ProjectSection> {
	if (!isRecord(raw)) {
		return { ok: false, errors: ['[project] section is required'] }
	}

	const name = runSchema(nameSchema, raw['name'])
	const type = runSchema(typeSchema, raw['type'])
	const filter = runSchema(filterSchema, raw['filter'])
	const domain = runSchema(domainSchema, raw['domain'])
	const redirectDomains = runSchema(
		redirectDomainsSchema,
		raw['redirect_domains'],
	)
	const internal = runSchema(internalSchema, raw['internal'])

	if (
		!name.ok ||
		!type.ok ||
		!filter.ok ||
		!domain.ok ||
		!redirectDomains.ok ||
		!internal.ok
	) {
		return {
			ok: false,
			errors: collectFieldErrors(
				name,
				type,
				filter,
				domain,
				redirectDomains,
				internal,
			),
		}
	}

	return {
		ok: true,
		section: {
			name: name.section,
			type: type.section,
			filter: filter.section,
			...(domain.section !== undefined && { domain: domain.section }),
			redirectDomains: redirectDomains.section,
			internal: internal.section,
		},
	}
}

export function validatePackageSection(
	raw: unknown,
): ValidationResult<PackageSection | false> {
	if (!isRecord(raw)) return { ok: true, section: false }

	const access = raw['access']
	if (typeof access !== 'string' || access === '') {
		return {
			ok: false,
			errors: ['package.access is required and must be a string'],
		}
	}

	return { ok: true, section: { access } }
}
