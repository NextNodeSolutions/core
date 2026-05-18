// End-to-end smoke test for the Postgres MVP workflow:
// provision (compose up) -> migrate (drizzle) -> insert -> backup (sh backup.sh)
// -> drop schema -> restore (list+select+download+pg_restore) -> row is back.
//
// One opt-in test gated on RUN_SMOKE=1 so CI can run it under a `smoke` job
// without slowing the default suite. Mirrors what the deploy pipeline does
// in production with MinIO standing in for R2.
//
// Run with: RUN_SMOKE=1 pnpm --filter @nextnode-solutions/infrastructure test postgres-mvp.smoke
// Prereqs: docker (running), pg_restore on PATH (brew install libpq && brew link --force libpq).

import { execSync } from 'node:child_process'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runDrizzleMigrations } from '#/adapters/postgres/drizzle-runner.ts'
import { runPgRestore } from '#/adapters/postgres/restore-runner.ts'
import {
	downloadPostgresBackup,
	listPostgresBackupSnapshots,
} from '#/adapters/r2/backup-store.ts'
import { selectPostgresBackupForRestore } from '#/domain/services/postgres.ts'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { Client } from 'pg'
import { describe, expect, it } from 'vitest'

const RUN = process.env.RUN_SMOKE === '1'

const thisFile = fileURLToPath(import.meta.url)
const thisDir = dirname(thisFile)
const composeFile = resolve(
	thisDir,
	'../../../test/postgres-roundtrip/compose.test.yml',
)
const migrationsFolder = resolve(
	thisDir,
	'../../../test/postgres-roundtrip/drizzle',
)
const bucket = 'nn-backups-test'
const databaseUrl = 'postgres://app:app@localhost:5433/app'

function compose(args: string): string {
	return `docker compose -f "${composeFile}" ${args}`
}

const SMOKE_TIMEOUT_MS = 240_000

describe.skipIf(!RUN)('postgres MVP smoke', () => {
	it(
		'provisions -> migrates -> inserts -> backs up -> drops -> restores -> row is back',
		async () => {
			const dumpPath = join(tmpdir(), `smoke-${String(Date.now())}.dump`)
			let pg: Client | null = null

			try {
				// 1. Provision: bring up postgres + minio + backup sidecar.
				execSync(compose('down -v'), { stdio: 'inherit' })
				execSync(compose('up -d --wait'), { stdio: 'inherit' })

				const s3 = new S3Client({
					region: 'auto',
					endpoint: 'http://localhost:9100',
					credentials: {
						accessKeyId: 'minioadmin',
						secretAccessKey: 'minioadmin',
					},
					forcePathStyle: true,
				})
				try {
					await s3.send(new CreateBucketCommand({ Bucket: bucket }))
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error)
					if (
						!message.includes('BucketAlreadyOwnedByYou') &&
						!message.includes('BucketAlreadyExists')
					) {
						throw error
					}
				}

				// 2. Migrate: apply drizzle migrations to create the schema.
				await runDrizzleMigrations({ databaseUrl, migrationsFolder })

				// 3. Insert: write data through the migrated schema.
				pg = new Client({ connectionString: databaseUrl })
				await pg.connect()
				await pg.query('INSERT INTO t VALUES (1), (2), (3);')

				// 4. Backup: trigger the sidecar's dump-and-upload script.
				execSync(compose('exec -T postgres-backup sh backup.sh'), {
					stdio: 'inherit',
				})

				// 5. Drop schema: simulate a data-loss event before restore.
				await pg.query('DROP TABLE t;')

				// 6. Restore: same adapter chain as `restoreCommand`, minus the
				// CF API call (loadR2Runtime) which is replaced by direct
				// MinIO credentials above.
				const snapshots = await listPostgresBackupSnapshots(s3, bucket)
				expect(snapshots).toHaveLength(1)
				const chosen = selectPostgresBackupForRestore(
					snapshots,
					new Date(Date.now() + 60_000),
				)
				if (chosen === null) {
					throw new Error('expected one snapshot to be selectable')
				}
				await downloadPostgresBackup(s3, bucket, chosen.key, dumpPath)
				runPgRestore({ databaseUrl, dumpPath })

				// 7. Verify: the inserted rows survived the round-trip.
				const result = await pg.query<{ x: number }>(
					'SELECT x FROM t ORDER BY x;',
				)
				expect(result.rows.map(r => r.x)).toEqual([1, 2, 3])
			} finally {
				if (pg !== null) {
					try {
						await pg.end()
					} catch {
						/* connection may already be closed */
					}
				}
				try {
					unlinkSync(dumpPath)
				} catch {
					/* dump file may not exist */
				}
				execSync(compose('down -v'), { stdio: 'inherit' })
			}
		},
		SMOKE_TIMEOUT_MS,
	)
})
