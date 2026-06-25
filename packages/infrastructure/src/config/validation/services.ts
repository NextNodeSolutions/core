import { SERVICE_NAMES } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'

import { validateObservabilityService } from './services/observability.ts'
import { validatePostgresService } from './services/postgres.ts'
import { validateR2Service } from './services/r2.ts'

import type {
	ObservabilityServiceConfig,
	PostgresServiceConfig,
	R2ServiceConfig,
	ServicesConfig,
} from '#/config/types.ts'
import type { ValidationResult } from './result.ts'

interface MutableServicesConfig {
	r2?: R2ServiceConfig
	postgres?: PostgresServiceConfig
	observability?: ObservabilityServiceConfig
}

/**
 * Validate the [services] table. Returns an empty `ServicesConfig` when no
 * services are declared - every backing service (R2, postgres, observability)
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
		if (r2Result.ok) {
			services.r2 = r2Result.section
		} else {
			errors.push(...r2Result.errors)
		}
	}

	if (raw['postgres'] !== undefined) {
		const postgresResult = validatePostgresService(raw['postgres'])
		if (postgresResult.ok) {
			services.postgres = postgresResult.section
		} else {
			errors.push(...postgresResult.errors)
		}
	}

	if (raw['observability'] !== undefined) {
		const observabilityResult = validateObservabilityService(
			raw['observability'],
		)
		if (observabilityResult.ok) {
			services.observability = observabilityResult.section
		} else {
			errors.push(...observabilityResult.errors)
		}
	}

	if (errors.length > 0) return { ok: false, errors }
	return { ok: true, section: services }
}

export function hasAnyService(services: ServicesConfig): boolean {
	return SERVICE_NAMES.some(name => services[name] !== undefined)
}
