import { DEFAULT_MIGRATE_COMMAND } from './target.ts'

import type { ServicesConfig } from '#/config/service-config.ts'

/**
 * The command the `migrate` job runs for a PlanetScale project: the declared
 * one, the default when none is declared, none when `migrate_command = false`
 * (the image owns its schema).
 */
export function planetscaleMigrateCommand(
	services: Pick<ServicesConfig, 'planetscale'>,
): string | undefined {
	if (!services.planetscale) return undefined
	const declared = services.planetscale.migrateCommand
	if (declared === false) return undefined
	return declared ?? DEFAULT_MIGRATE_COMMAND
}

/** Whether the pipeline runs a `migrate` job: D1, or a PlanetScale command. */
export function hasMigrations(
	services: Pick<ServicesConfig, 'd1' | 'planetscale'>,
): boolean {
	return (
		Boolean(services.d1) ||
		typeof planetscaleMigrateCommand(services) !== 'undefined'
	)
}
