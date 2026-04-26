import type { PackageSection, ProjectSection } from '@/config/types.ts'
import {
	isProjectType,
	isRecord,
	isScriptValue,
	KEBAB_IDENTIFIER_PATTERN,
	PROJECT_TYPES,
} from '@/config/types.ts'

import type { ValidationResult } from './result.ts'

function validateProjectName(value: unknown): {
	errors: string[]
	name: string | undefined
} {
	if (!value || typeof value !== 'string') {
		return {
			errors: ['project.name is required and must be a string'],
			name: undefined,
		}
	}
	if (!KEBAB_IDENTIFIER_PATTERN.test(value)) {
		return {
			errors: [
				`project.name must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
			],
			name: undefined,
		}
	}
	return { errors: [], name: value }
}

function validateDomainFields(raw: Record<string, unknown>): {
	errors: string[]
	domain: string | undefined
	redirectDomains: ReadonlyArray<string>
} {
	const errors: string[] = []
	const domain = raw['domain']
	if (domain !== undefined && (typeof domain !== 'string' || domain === '')) {
		errors.push('project.domain must be a non-empty string')
	}

	const redirectDomains = raw['redirect_domains']
	if (redirectDomains !== undefined) {
		if (!Array.isArray(redirectDomains)) {
			errors.push('project.redirect_domains must be an array of strings')
		} else if (
			!redirectDomains.every(
				(entry): entry is string =>
					typeof entry === 'string' && entry !== '',
			)
		) {
			errors.push(
				'project.redirect_domains entries must be non-empty strings',
			)
		}
	}

	return {
		errors,
		domain: typeof domain === 'string' ? domain : undefined,
		redirectDomains: Array.isArray(redirectDomains)
			? redirectDomains.filter(
					(entry): entry is string => typeof entry === 'string',
				)
			: [],
	}
}

export function validateProjectSection(
	raw: unknown,
): ValidationResult<ProjectSection> {
	if (!isRecord(raw)) {
		return { ok: false, errors: ['[project] section is required'] }
	}

	const errors: string[] = []

	const nameResult = validateProjectName(raw['name'])
	errors.push(...nameResult.errors)

	const type = raw['type']
	if (!type || !isProjectType(type)) {
		errors.push(
			`project.type is required and must be one of: ${PROJECT_TYPES.join(', ')}`,
		)
	}

	const filter = raw['filter']
	if (filter !== undefined && !isScriptValue(filter)) {
		errors.push('project.filter must be a string or false')
	}

	const domainResult = validateDomainFields(raw)
	errors.push(...domainResult.errors)

	const internal = raw['internal']
	if (internal !== undefined && typeof internal !== 'boolean') {
		errors.push('project.internal must be a boolean')
	}

	if (
		errors.length > 0 ||
		nameResult.name === undefined ||
		!isProjectType(type)
	) {
		return { ok: false, errors }
	}

	return {
		ok: true,
		section: {
			name: nameResult.name,
			type,
			filter: isScriptValue(filter) ? filter : false,
			domain: domainResult.domain,
			redirectDomains: domainResult.redirectDomains,
			internal: internal === true,
		},
	}
}

export function validatePackageSection(
	raw: unknown,
): ValidationResult<PackageSection | false> {
	if (!isRecord(raw)) return { ok: true, section: false }

	const access = raw['access']
	if (!access || typeof access !== 'string') {
		return {
			ok: false,
			errors: ['package.access is required and must be a string'],
		}
	}

	return { ok: true, section: { access } }
}
