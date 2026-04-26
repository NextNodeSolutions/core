import type { R2ServiceConfig } from '@/config/types.ts'
import { KEBAB_IDENTIFIER_PATTERN, isRecord } from '@/config/types.ts'
import type { ValidationResult } from '@/config/validation/result.ts'

export function validateR2Service(
	raw: unknown,
): ValidationResult<R2ServiceConfig> {
	if (!isRecord(raw)) {
		return { ok: false, errors: ['[services.r2] must be a table'] }
	}

	const rawBuckets = raw['buckets']
	if (!Array.isArray(rawBuckets)) {
		return {
			ok: false,
			errors: ['services.r2.buckets must be an array of strings'],
		}
	}
	if (rawBuckets.length === 0) {
		return {
			ok: false,
			errors: [
				'services.r2.buckets must declare at least one bucket alias',
			],
		}
	}

	const errors: string[] = []
	const seen = new Set<string>()
	const aliases: string[] = []

	for (const entry of rawBuckets) {
		if (typeof entry !== 'string' || entry === '') {
			errors.push('services.r2.buckets entries must be non-empty strings')
			continue
		}
		if (!KEBAB_IDENTIFIER_PATTERN.test(entry)) {
			errors.push(
				`services.r2.buckets entry "${entry}" must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
			)
			continue
		}
		if (seen.has(entry)) {
			errors.push(`services.r2.buckets entry "${entry}" is duplicated`)
			continue
		}
		seen.add(entry)
		aliases.push(entry)
	}

	if (errors.length > 0) return { ok: false, errors }

	return { ok: true, section: { buckets: aliases } }
}
