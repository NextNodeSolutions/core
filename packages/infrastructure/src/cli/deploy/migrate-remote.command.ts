import { writeSummary } from '#/adapters/github/output.ts'
import { buildMigrateSummary } from '#/domain/deploy/migrate-summary.ts'
import { planetscaleMigrateCommand } from '#/domain/deploy/migrations.ts'

import { resolveDeployContext } from './resolve-deploy-context.ts'

import type { DeployableConfig } from '#/config/types.ts'

export async function migrateRemoteCommand(
	config: DeployableConfig,
): Promise<void> {
	if (!config.services.d1 && !config.services.planetscale) return
	const { target, environment } = await resolveDeployContext(config)
	const projectName = config.project.name
	if (config.services.d1) {
		const migration = await target.runMigrate({
			kind: 'd1',
			projectName,
			environment,
		})
		writeSummary(
			buildMigrateSummary({
				projectName,
				environment,
				migrateDurationMs: migration.durationMs,
			}),
		)
	}
	const migrateCommand = planetscaleMigrateCommand(config.services)
	if (migrateCommand) {
		const migration = await target.runMigrate({
			kind: 'planetscale',
			projectName,
			environment,
			migrateCommand,
		})
		writeSummary(
			buildMigrateSummary({
				projectName,
				environment,
				migrateDurationMs: migration.durationMs,
			}),
		)
	}
}
