import { writeSummary } from '#/adapters/github/output.ts'
import { buildMigrateSummary } from '#/domain/deploy/migrate-summary.ts'
import { DEFAULT_MIGRATE_COMMAND } from '#/domain/deploy/target.ts'

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
	if (config.services.planetscale) {
		const migration = await target.runMigrate({
			kind: 'planetscale',
			projectName,
			environment,
			migrateCommand:
				config.services.planetscale.migrateCommand ??
				DEFAULT_MIGRATE_COMMAND,
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
