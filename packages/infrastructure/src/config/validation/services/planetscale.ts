import { isRecord } from '#/kernel/guards.ts'
import { literal, optional, union } from 'valibot'

import {
	collectFieldErrors,
	nonEmptyString,
	optionalNonEmpty,
	runSchema,
} from '../valibot.ts'

import type { PlanetscaleServiceConfig } from '#/config/service-config.ts'
import type { ValidationResult } from '#/config/validation/result.ts'

const clusterSizeSchema = optionalNonEmpty(
	'services.planetscale.cluster_size must be a non-empty string when set',
)
const MIGRATE_COMMAND_MESSAGE =
	'services.planetscale.migrate_command must be a non-empty string, or false when the project runs no migration'
// A string runs in the `migrate` job; `false` skips the job for a project
// whose image owns its schema.
const migrateCommandSchema = optional(
	union(
		[nonEmptyString(MIGRATE_COMMAND_MESSAGE), literal(false)],
		MIGRATE_COMMAND_MESSAGE,
	),
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

	const migrateCommand = runSchema(
		migrateCommandSchema,
		raw['migrate_command'],
	)
	if (!clusterSize.ok || !region.ok || !migrateCommand.ok) {
		return {
			ok: false,
			errors: collectFieldErrors(clusterSize, region, migrateCommand),
		}
	}

	return {
		ok: true,
		section: {
			...(typeof migrateCommand.section !== 'undefined' && {
				migrateCommand: migrateCommand.section,
			}),
			...(clusterSize.section && {
				clusterSize: clusterSize.section,
			}),
			...(region.section && { region: region.section }),
		},
	}
}
