import { isRecord } from '#/kernel/guards.ts'

import { collectFieldErrors, optionalNonEmpty, runSchema } from '../valibot.ts'

import type { PlanetscaleServiceConfig } from '#/config/service-config.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

const clusterSizeSchema = optionalNonEmpty(
	'services.planetscale.cluster_size must be a non-empty string when set',
)
const regionSchema = optionalNonEmpty(
	'services.planetscale.region must be a non-empty string when set',
)

export function validatePlanetscaleService(
	raw: unknown,
): ValidationResult<PlanetscaleServiceConfig> {
	if (!isRecord(raw)) {
		return { ok: false, errors: ['[services.planetscale] must be a table'] }
	}

	const clusterSize = runSchema(clusterSizeSchema, raw['cluster_size'])
	const region = runSchema(regionSchema, raw['region'])

	if (!clusterSize.ok || !region.ok) {
		return { ok: false, errors: collectFieldErrors(clusterSize, region) }
	}

	return {
		ok: true,
		section: {
			...(clusterSize.section && {
				clusterSize: clusterSize.section,
			}),
			...(region.section && { region: region.section }),
		},
	}
}
