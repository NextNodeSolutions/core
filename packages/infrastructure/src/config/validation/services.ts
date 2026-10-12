import { SERVICE_NAMES } from '#/config/service-config.ts'
import { isRecord } from '#/kernel/guards.ts'

import { validateD1Service } from './services/d1.ts'
import { validateKvService } from './services/kv.ts'
import { validatePlanetscaleService } from './services/planetscale.ts'
import { validateQueuesService } from './services/queues.ts'
import { validateR2Service } from './services/r2.ts'

import type {
	ServiceConfigByName,
	ServiceName,
	ServicesConfig,
} from '#/config/service-config.ts'
import type { ValidationResult } from './result.ts'

type MutableServicesConfig = {
	-readonly [K in ServiceName]?: ServiceConfigByName[K]
}
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

export function validateServicesSection(
	raw: unknown,
): ValidationResult<ServicesConfig> {
	if (typeof raw === 'undefined') return { ok: true, section: {} }
	if (!isRecord(raw)) {
		return { ok: false, errors: ['[services] must be a table'] }
	}

	const errors = Object.keys(raw)
		.filter(name => !SERVICE_NAMES.some(supported => supported === name))
		.map(name => `Unknown backing service "${name}"`)
	const services: MutableServicesConfig = {}

	const r2 = runService(raw['r2'], validateR2Service, errors)
	if (r2) services.r2 = r2

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
