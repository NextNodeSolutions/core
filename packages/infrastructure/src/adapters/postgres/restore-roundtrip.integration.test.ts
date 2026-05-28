// Integration test for the real postgres -> R2 -> pg_restore round-trip.
// Spins up docker compose (postgres + MinIO + ghcr.io/solectrus/postgres-s3-backup),
// triggers `sh backup.sh`, then exercises listPostgresBackupSnapshots,
// selectPostgresBackupForRestore, downloadPostgresBackup, and runPgRestore.
// Run with: RUN_INTEGRATION=1 pnpm --filter @nextnode-solutions/infrastructure test restore-roundtrip
// Prereqs: docker (running), pg_restore on PATH (brew install libpq && brew link --force libpq).

import { execSync } from 'node:child_process'
import { statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runPgRestore } from '#/adapters/postgres/restore-runner.ts'
import {
	downloadPostgresBackup,
	listPostgresBackupSnapshots,
} from '#/adapters/r2/backup-store.ts'
import { selectPostgresBackupForRestore } from '#/domain/services/postgres.ts'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { PostgresBackupSnapshot } from '#/domain/services/postgres.ts'

const RUN = process.env.RUN_INTEGRATION === '1'

const thisFile = fileURLToPath(import.meta.url)
const thisDir = dirname(thisFile)

const composeFile = resolve(
	thisDir,
	'../../../test/postgres-roundtrip/compose.test.yml',
)
const bucket = 'nn-backups-test'
const databaseUrl = 'postgres://app:app@localhost:5433/app'

function compose(args: string): string {
	return `docker compose -f "${composeFile}" ${args}`
}

const COMPOSE_TIMEOUT_MS = 180_000

describe.skipIf(!RUN)('postgres dump -> R2 -> restore round-trip', () => {
	let s3: S3Client
	let pg: Client
	let dumpPath: string
	let snapshots: PostgresBackupSnapshot[]
	let chosen: PostgresBackupSnapshot

	beforeAll(async () => {
		execSync(compose('down -v'), { stdio: 'inherit' })
		execSync(compose('up -d --wait'), { stdio: 'inherit' })

		s3 = new S3Client({
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

		pg = new Client({ connectionString: databaseUrl })
		await pg.connect()
		await pg.query('CREATE TABLE IF NOT EXISTS t (x int);')
		await pg.query('TRUNCATE t;')
		await pg.query('INSERT INTO t VALUES (1), (2), (3);')

		execSync(compose('exec -T postgres-backup sh backup.sh'), {
			stdio: 'inherit',
		})

		dumpPath = join(tmpdir(), `roundtrip-${String(Date.now())}.dump`)
	}, COMPOSE_TIMEOUT_MS)

	afterAll(async () => {
		try {
			await pg.end()
		} catch {
			/* connection may already be closed */
		}
		try {
			unlinkSync(dumpPath)
		} catch {
			/* dump file may not exist */
		}
		execSync(compose('down -v'), { stdio: 'inherit' })
	})

	it('lists exactly one snapshot matching the real <db>_<timestamp>.dump key shape', async () => {
		snapshots = await listPostgresBackupSnapshots(s3, bucket)
		expect(snapshots).toHaveLength(1)
		expect(snapshots[0]?.key).toMatch(
			/^postgres\/app_\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.dump$/,
		)
	})

	it('selects that snapshot as the latest <= now+1min', () => {
		const result = selectPostgresBackupForRestore(
			snapshots,
			new Date(Date.now() + 60_000),
		)
		if (result === null) {
			throw new Error(
				'expected selectPostgresBackupForRestore to return a snapshot',
			)
		}
		expect(result.key).toBe(snapshots[0]?.key)
		chosen = result
	})

	it('downloads the dump to disk', async () => {
		await downloadPostgresBackup(s3, bucket, chosen.key, dumpPath)
		expect(statSync(dumpPath).size).toBeGreaterThan(0)
	})

	it('restores the dropped table via runPgRestore', async () => {
		await pg.query('DROP TABLE t;')
		runPgRestore({ databaseUrl, dumpPath })
		const res = await pg.query<{ x: number }>('SELECT x FROM t ORDER BY x;')
		expect(res.rows.map(r => r.x)).toEqual([1, 2, 3])
	})
})
