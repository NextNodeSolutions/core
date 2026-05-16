import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

export interface DrizzleMigrateOptions {
	readonly databaseUrl: string
	readonly migrationsFolder: string
}

/**
 * Apply pending drizzle migrations against `databaseUrl`. Uses the
 * `drizzle-orm` runtime migrator (not the `drizzle-kit` CLI) so there
 * is no pnpm/workspace dependency to satisfy in CI — we open a single
 * `pg.Client`, run the migrator, and close.
 *
 * `migrationsFolder` is the on-disk path to the directory holding the
 * generated SQL files (drizzle-kit's `out` setting). The dev runs
 * `drizzle-kit generate` locally; the SQL is committed; this command
 * just applies what's there.
 *
 * Throws on any migration failure so the caller aborts the deploy
 * before traffic swap. Concurrent deploys are serialised at the
 * workflow level via a GitHub Actions `concurrency` group.
 */
export async function runDrizzleMigrations(
	options: DrizzleMigrateOptions,
): Promise<void> {
	const client = new Client({ connectionString: options.databaseUrl })
	await client.connect()
	try {
		const db = drizzle(client)
		await migrate(db, { migrationsFolder: options.migrationsFolder })
	} finally {
		await client.end()
	}
}
