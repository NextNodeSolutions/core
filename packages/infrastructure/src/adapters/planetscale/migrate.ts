import { execFile } from 'node:child_process'

import {
	PLANETSCALE_POSTGRES_PORT,
	PLANETSCALE_POSTGRES_SCHEME,
} from '#/domain/cloudflare/workers/planetscale.ts'

import type { WorkersTerraformOutputs } from '#/domain/cloudflare/workers/outputs-env.ts'
import type { MigrateResult } from '#/domain/deploy/target.ts'

const MIGRATION_TIMEOUT_MS = 900_000

export async function migratePlanetscale(
	credentials: WorkersTerraformOutputs['planetscaleMigrator'],
	command: string,
	projectDir: string,
): Promise<MigrateResult> {
	if (!credentials)
		throw new Error(
			'PlanetScale migrator outputs are missing. Run provision before migrate-remote.',
		)
	const databaseUrl = new URL(`${PLANETSCALE_POSTGRES_SCHEME}://localhost`)
	databaseUrl.hostname = credentials.host
	databaseUrl.port = String(PLANETSCALE_POSTGRES_PORT)
	databaseUrl.pathname = credentials.database
	databaseUrl.username = credentials.user
	databaseUrl.password = credentials.password
	databaseUrl.searchParams.set('sslmode', 'verify-full')
	const startedAt = Date.now()
	await new Promise<void>((resolve, reject) => {
		execFile(
			'/bin/sh',
			['-c', command],
			{
				cwd: projectDir,
				env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
				timeout: MIGRATION_TIMEOUT_MS,
			},
			error => {
				if (error) {
					reject(
						new Error(
							'PlanetScale migration failed. Inspect the migration command and database permissions.',
						),
					)
					return
				}
				resolve()
			},
		)
	})
	return { durationMs: Date.now() - startedAt }
}
