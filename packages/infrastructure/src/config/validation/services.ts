import { SERVICE_NAMES } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'

import { validateD1Service } from './services/d1.ts'
import { validateKvService } from './services/kv.ts'
import { validateObservabilityService } from './services/observability.ts'
import { validatePlanetscaleService } from './services/planetscale.ts'
import { validatePostgresService } from './services/postgres.ts'
import { validateQueuesService } from './services/queues.ts'
import { validateR2Service } from './services/r2.ts'

import type {
	ServiceConfigByName,
	ServiceName,
	ServicesConfig,
} from '#/config/types.ts'
import type { ValidationResult } from './result.ts'

type MutableServicesConfig = {
	-readonly [K in ServiceName]?: ServiceConfigByName[K]
}

// Validate one optional sub-table: absent -> undefined; present + valid ->
// its section; present + invalid -> undefined after appending its errors. The
// caller assigns the section under a LITERAL key so each service keeps its
// precise type (a union-keyed write would collapse to their intersection).
function runService<T>(
	raw: unknown,
	validate: (raw: unknown) => ValidationResult<T>,
	errors: string[],
): T | undefined {
	if (typeof raw === 'undefined') return undefined
	const validation = validate(raw)
	if (validation.ok) return validation.section
	errors.push(...validation.errors)
	return undefined
}

/**
 * Validate the [services] table. Returns an empty `ServicesConfig` when no
 * services are declared - every backing service lives as an optional sub-table
 * under `[services.<name>]`.
 */
export function validateServicesSection(
	raw: unknown,
): ValidationResult<ServicesConfig> {
	if (typeof raw === 'undefined') return { ok: true, section: {} }
	if (!isRecord(raw)) {
		return { ok: false, errors: ['[services] must be a table'] }
	}

	const errors: string[] = []
	const services: MutableServicesConfig = {}

	const r2 = runService(raw['r2'], validateR2Service, errors)
	if (r2) services.r2 = r2

	const postgres = runService(
		raw['postgres'],
		validatePostgresService,
		errors,
	)
	if (postgres) services.postgres = postgres

	const observability = runService(
		raw['observability'],
		validateObservabilityService,
		errors,
	)
	if (observability) services.observability = observability

	const d1 = runService(raw['d1'], validateD1Service, errors)
	if (d1) services.d1 = d1

	const kv = runService(raw['kv'], validateKvService, errors)
	if (kv) services.kv = kv

	const queues = runService(raw['queues'], validateQueuesService, errors)
	if (queues) services.queues = queues

	const planetscale = runService(
		raw['planetscale'],
		validatePlanetscaleService,
		errors,
	)
	if (planetscale) services.planetscale = planetscale

	if (errors.length > 0) return { ok: false, errors }
	return { ok: true, section: services }
}

export function hasAnyService(services: ServicesConfig): boolean {
	return SERVICE_NAMES.some(name => Boolean(services[name]))
}
