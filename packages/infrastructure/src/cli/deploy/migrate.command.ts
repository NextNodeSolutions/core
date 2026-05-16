import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { runDrizzleMigrations } from '#/adapters/postgres/drizzle-runner.ts'
import { requireEnv } from '#/cli/env.ts'
import type { DeployableConfig } from '#/config/types.ts'

/**
 * Default migrations directory, resolved relative to nextnode.toml.
 * Matches drizzle-kit's own default `out` value, so the common case
 * needs no extra config. Override with [services.postgres].migrations_folder.
 */
const DEFAULT_MIGRATIONS_DIRNAME = 'drizzle'

export async function migrateCommand(config: DeployableConfig): Promise<void> {
	const configFile = requireEnv('PIPELINE_CONFIG_FILE')
	const folder =
		config.services.postgres?.migrationsFolder ?? DEFAULT_MIGRATIONS_DIRNAME
	const migrationsFolder = join(dirname(configFile), folder)

	if (!existsSync(migrationsFolder)) {
		throw new Error(
			`migrate: migrations folder "${migrationsFolder}" not found. Run "drizzle-kit generate" in the project and commit the output; if your drizzle-kit "out" is not "${DEFAULT_MIGRATIONS_DIRNAME}/", set [services.postgres].migrations_folder to match.`,
		)
	}

	const databaseUrl = requireEnv('DATABASE_URL')
	logger.info(
		`Running migrate for "${config.project.name}" from ${migrationsFolder}`,
	)
	await runDrizzleMigrations({ databaseUrl, migrationsFolder })
	logger.info(`Migrations applied for "${config.project.name}"`)
}
