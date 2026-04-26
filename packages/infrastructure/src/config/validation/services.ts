import type { R2ServiceConfig, ServicesConfig } from '#/config/types.ts'
import { isRecord, SERVICE_NAMES } from '#/config/types.ts'

import type { ValidationResult } from './result.ts'
import { validateR2Service } from './services/r2.ts'

interface MutableServicesConfig {
	r2?: R2ServiceConfig
}

/**
 * Validate the [services] table. Returns an empty `ServicesConfig` when no
 * services are declared — every backing service (R2, future Supabase, Redis)
 * lives as an optional sub-table under `[services.<name>]`.
 */
export function validateServicesSection(
	raw: unknown,
): ValidationResult<ServicesConfig> {
	if (raw === undefined) return { ok: true, section: {} }
	if (!isRecord(raw)) {
		return { ok: false, errors: ['[services] must be a table'] }
	}

	const errors: string[] = []
	const services: MutableServicesConfig = {}

	if (raw['r2'] !== undefined) {
		const r2Result = validateR2Service(raw['r2'])
		if (!r2Result.ok) {
			errors.push(...r2Result.errors)
		} else {
			services.r2 = r2Result.section
		}
	}

	if (errors.length > 0) return { ok: false, errors }
	return { ok: true, section: services }
}

export function hasAnyService(services: ServicesConfig): boolean {
	return SERVICE_NAMES.some(name => services[name] !== undefined)
}
