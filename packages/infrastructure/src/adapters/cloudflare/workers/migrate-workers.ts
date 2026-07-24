import { wranglerD1MigrationsApply } from '#/adapters/wrangler/migrate.ts'
import { defaultWranglerRunner } from '#/adapters/wrangler/runner.ts'
import { buildWranglerConfig } from '#/domain/cloudflare/workers/wrangler-config.ts'
import { resolveD1MigrationServiceName } from '#/domain/deploy/migration-service.ts'

import type { WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { ServicesConfig } from '#/config/service-config.ts'
import type { CronJobConfig, WorkerServiceConfig } from '#/config/types.ts'
import type { WorkersTerraformOutputs } from '#/domain/cloudflare/workers/outputs-env.ts'
import type { MigrateResult } from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

export interface WorkersMigrateInput {
	readonly projectName: string
	readonly environment: AppEnvironment
	// Declared workers; the D1 migration runs against the config of the first one
	// that lists `needs = ["d1"]`.
	readonly services: Readonly<Record<string, WorkerServiceConfig>>
	// The [services.*] block (backing resources); the D1 binding is filtered in
	// by the owning service's `needs` inside `buildWranglerConfig`.
	readonly backingServices: ServicesConfig
	readonly cron: ReadonlyArray<CronJobConfig>
	// Provision outputs, read ONCE by the caller (carries `d1DatabaseId`).
	readonly outputs: WorkersTerraformOutputs
	readonly wranglerRunner: WranglerRunner | undefined
	// The project package dir wrangler runs from (where the migrations live).
	readonly projectDir: string
}

/**
 * Run the project's D1 migrations. Picks the owning Worker (first declaring
 * `needs = ["d1"]`), regenerates its wrangler config (the same document deploy
 * writes, so the D1 binding + `migrations_dir` match exactly), and applies the
 * pending migrations against the remote database. Returns the wall-clock
 * duration for the migrate summary.
 */
export async function migrateWorkers(
	input: WorkersMigrateInput,
): Promise<MigrateResult> {
	const start = Date.now()
	const runner = input.wranglerRunner ?? defaultWranglerRunner
	const ownerName = resolveD1MigrationServiceName(input.services)
	const owner = input.services[ownerName]
	if (!owner) {
		throw new Error(
			`Resolved D1 migration owner "${ownerName}" is not a declared service - wiring bug`,
		)
	}

	const document = buildWranglerConfig({
		projectName: input.projectName,
		environment: input.environment,
		serviceName: ownerName,
		service: owner,
		services: input.backingServices,
		outputs: input.outputs,
		cron: input.cron,
		serviceNames: Object.keys(input.services),
		vars: {},
	})

	const databaseName = document.d1_databases?.[0]?.database_name
	if (typeof databaseName === 'undefined') {
		throw new Error(
			`Owning service "${ownerName}" produced no D1 binding while [services.d1] is set - wiring bug`,
		)
	}

	await wranglerD1MigrationsApply({
		document,
		databaseName,
		runner,
		cwd: input.projectDir,
	})

	return { durationMs: Date.now() - start }
}
