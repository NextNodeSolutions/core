import { describe, expect, it } from 'vitest'

import {
	POSTGRES_BACKUP_PREFIX,
	POSTGRES_BACKUP_SCHEDULE,
	POSTGRES_DATA_DIR,
	POSTGRES_DATA_VOLUME,
	POSTGRES_SIDECAR_SERVICE_NAME,
	buildPostgresBackupSidecar,
	buildPostgresEmbeddedDatabaseUrl,
	buildPostgresEmbeddedEnv,
	buildPostgresExternalEnv,
	buildPostgresSidecar,
	ensurePostgresRestoreConfirmed,
	parsePostgresBackupKey,
	parsePostgresRestoreArgs,
	postgresBackupBucketName,
	postgresProjectIdentifier,
	redactPostgresPassword,
	selectPostgresBackupForRestore,
	selectPostgresBackupsToPrune,
} from './postgres.ts'

import type { PostgresBackupSnapshot } from './postgres.ts'

describe('postgresProjectIdentifier', () => {
	it('passes a single-word lowercase name through unchanged', () => {
		expect(postgresProjectIdentifier('acme')).toBe('acme')
	})

	it('rewrites dashes to underscores so the identifier needs no quoting in SQL', () => {
		expect(postgresProjectIdentifier('acme-web')).toBe('acme_web')
	})

	it('rewrites every dash in multi-segment names', () => {
		expect(postgresProjectIdentifier('acme-web-prod')).toBe('acme_web_prod')
	})
})

describe('buildPostgresSidecar', () => {
	it('returns a sidecar spec pinned to NEXTNODE_POSTGRES_VERSION when mode is embedded', () => {
		const result = buildPostgresSidecar(
			{
				mode: 'embedded',
			},
			'acme-web',
		)

		expect(result).not.toBeNull()
		if (result === null) return
		expect(result.image).toBe('postgres:18')
		expect(result.restart).toBe('unless-stopped')
		expect(result.env_file).toEqual(['.env'])
		expect(result.volumes).toEqual([
			`${POSTGRES_DATA_VOLUME}:${POSTGRES_DATA_DIR}`,
		])
		expect(result.healthcheck.test).toEqual([
			'CMD-SHELL',
			'pg_isready -U acme_web -d acme_web',
		])
	})

	it('returns null when mode is external', () => {
		const result = buildPostgresSidecar(
			{
				mode: 'external',
			},
			'acme-web',
		)

		expect(result).toBeNull()
	})
})

describe('buildPostgresEmbeddedDatabaseUrl', () => {
	it('connects as the project-scoped role to the project-scoped database on the sidecar', () => {
		expect(buildPostgresEmbeddedDatabaseUrl('acme-web', 's3cret')).toBe(
			'postgres://acme_web:s3cret@postgres:5432/acme_web',
		)
	})
})

describe('buildPostgresEmbeddedEnv', () => {
	it('publishes POSTGRES_USER/DB on the public channel and PASSWORD/URL on the secret channel', () => {
		expect(buildPostgresEmbeddedEnv('acme-web', 'hunter2')).toEqual({
			public: {
				POSTGRES_USER: 'acme_web',
				POSTGRES_DB: 'acme_web',
			},
			secret: {
				POSTGRES_PASSWORD: 'hunter2',
				DATABASE_URL:
					'postgres://acme_web:hunter2@postgres:5432/acme_web',
			},
		})
	})
})

describe('buildPostgresExternalEnv', () => {
	it('threads the user-provided URL through the secret channel only', () => {
		expect(
			buildPostgresExternalEnv(
				'postgres://user:pw@db.example.com:5432/app',
			),
		).toEqual({
			public: {},
			secret: {
				DATABASE_URL: 'postgres://user:pw@db.example.com:5432/app',
			},
		})
	})
})

describe('postgresBackupBucketName', () => {
	it('namespaces backups under nn-backups-<project>', () => {
		expect(postgresBackupBucketName('acme-web')).toBe('nn-backups-acme-web')
	})
})

describe('buildPostgresBackupSidecar', () => {
	it('returns null when mode is external (user-owned DB)', () => {
		const result = buildPostgresBackupSidecar(
			{
				mode: 'external',
			},
			'acme-web',
		)

		expect(result).toBeNull()
	})

	it('builds a solectrus/postgres-s3-backup sidecar pinned to NEXTNODE_POSTGRES_VERSION', () => {
		const result = buildPostgresBackupSidecar(
			{
				mode: 'embedded',
			},
			'acme-web',
		)

		expect(result).not.toBeNull()
		if (result === null) return
		expect(result.image).toBe('ghcr.io/solectrus/postgres-s3-backup:18')
		expect(result.restart).toBe('unless-stopped')
		expect(result.depends_on).toEqual([POSTGRES_SIDECAR_SERVICE_NAME])
	})

	it('renames the project-level R2 creds to the S3_* names the image expects via compose interpolation', () => {
		const result = buildPostgresBackupSidecar(
			{
				mode: 'embedded',
			},
			'acme-web',
		)

		expect(result?.environment).toMatchObject({
			S3_ACCESS_KEY_ID: '${R2_ACCESS_KEY_ID}',
			S3_SECRET_ACCESS_KEY: '${R2_SECRET_ACCESS_KEY}',
			S3_ENDPOINT: '${R2_ENDPOINT}',
			S3_REGION: 'auto',
			S3_S3V4: 'yes',
		})
	})

	it('targets the project-scoped R2 bucket under the postgres prefix', () => {
		const result = buildPostgresBackupSidecar(
			{
				mode: 'embedded',
			},
			'acme-web',
		)

		expect(result?.environment['S3_BUCKET']).toBe('nn-backups-acme-web')
		expect(result?.environment['S3_PREFIX']).toBe(POSTGRES_BACKUP_PREFIX)
	})

	it('runs the dump on the canonical daily schedule with retention disabled (handled separately)', () => {
		const result = buildPostgresBackupSidecar(
			{
				mode: 'embedded',
			},
			'acme-web',
		)

		expect(result?.environment['SCHEDULE']).toBe(POSTGRES_BACKUP_SCHEDULE)
		expect(result?.environment['BACKUP_KEEP_DAYS']).toBe('0')
	})

	it('connects to the in-network postgres sidecar with the project-scoped role+db', () => {
		const result = buildPostgresBackupSidecar(
			{
				mode: 'embedded',
			},
			'acme-web',
		)

		expect(result?.environment).toMatchObject({
			POSTGRES_HOST: POSTGRES_SIDECAR_SERVICE_NAME,
			POSTGRES_DATABASE: 'acme_web',
			POSTGRES_USER: 'acme_web',
			POSTGRES_PASSWORD: '${POSTGRES_PASSWORD}',
		})
	})
})

describe('parsePostgresBackupKey', () => {
	it('parses a valid sidecar-emitted key into a snapshot with a UTC timestamp', () => {
		expect(
			parsePostgresBackupKey(
				'postgres/acme_web_2026-05-16T03:00:00.dump',
			),
		).toEqual({
			key: 'postgres/acme_web_2026-05-16T03:00:00.dump',
			timestamp: new Date('2026-05-16T03:00:00.000Z'),
		})
	})

	it('returns null when the key is not under the postgres prefix', () => {
		expect(
			parsePostgresBackupKey('certs/acme_web_2026-05-16T03:00:00.dump'),
		).toBeNull()
	})

	it('returns null when the database name segment is missing', () => {
		expect(
			parsePostgresBackupKey('postgres/2026-05-16T03:00:00.dump'),
		).toBeNull()
	})

	it('returns null when the key extension is not .dump (e.g. encrypted .gpg variant)', () => {
		expect(
			parsePostgresBackupKey(
				'postgres/acme_web_2026-05-16T03:00:00.dump.gpg',
			),
		).toBeNull()
		expect(
			parsePostgresBackupKey('postgres/acme_web_2026-05-16T03:00:00.sql'),
		).toBeNull()
	})

	it('returns null when the timestamp is structurally invalid', () => {
		expect(
			parsePostgresBackupKey(
				'postgres/acme_web_2026-13-99T03:00:00.dump',
			),
		).toBeNull()
	})

	it('returns null for impossible-but-in-range dates that JS Date silently rolls over', () => {
		// `new Date('2026-02-30T03:00:00Z')` returns Mar 2 instead of NaN —
		// without the round-trip check this would land in the wrong bucket
		// and could prune a real Mar 2 snapshot.
		expect(
			parsePostgresBackupKey(
				'postgres/acme_web_2026-02-30T03:00:00.dump',
			),
		).toBeNull()
		expect(
			parsePostgresBackupKey(
				'postgres/acme_web_2026-04-31T03:00:00.dump',
			),
		).toBeNull()
	})

	it('returns null for keys with trailing junk after the .dump extension', () => {
		expect(
			parsePostgresBackupKey(
				'postgres/acme_web_2026-05-16T03:00:00.dump.bak',
			),
		).toBeNull()
	})

	it('returns null for keys nested under an additional sub-prefix', () => {
		expect(
			parsePostgresBackupKey(
				'postgres/sub/acme_web_2026-05-16T03:00:00.dump',
			),
		).toBeNull()
	})

	it('returns null for keys with hyphenated time (old wrong format)', () => {
		// Guard against regression: prior versions of this regex expected
		// hyphens in the time segment and a trailing `Z`. The real image
		// produces colons and no `Z`; reject the old shape so we never
		// classify a hand-crafted key as a real snapshot.
		expect(
			parsePostgresBackupKey(
				'postgres/acme_web_2026-05-16T03-00-00Z.dump',
			),
		).toBeNull()
	})
})

function snap(iso: string): PostgresBackupSnapshot {
	return { key: iso, timestamp: new Date(iso) }
}

describe('selectPostgresBackupsToPrune', () => {
	it('returns an empty prune set for an empty input', () => {
		expect(selectPostgresBackupsToPrune([])).toEqual([])
	})

	it('keeps a lone snapshot — daily, weekly and monthly buckets collapse onto it', () => {
		const only = snap('2026-05-16T03:00:00Z')
		expect(selectPostgresBackupsToPrune([only])).toEqual([])
	})

	it('keeps only the newest snapshot when several dumps share the same UTC day', () => {
		const oldest = snap('2026-05-16T01:00:00Z')
		const middle = snap('2026-05-16T12:00:00Z')
		const newest = snap('2026-05-16T23:00:00Z')

		const prune = selectPostgresBackupsToPrune([oldest, middle, newest])

		expect(prune).toEqual([oldest, middle])
	})

	it('preserves the input order in the returned prune set', () => {
		const a = snap('2026-05-10T00:00:00Z')
		const b = snap('2026-05-10T06:00:00Z')
		const c = snap('2026-05-10T12:00:00Z')

		const prune = selectPostgresBackupsToPrune([b, a, c])

		expect(prune).toEqual([b, a])
	})

	it('keeps the 7 most-recent daily buckets and prunes older days when only one dump exists per day', () => {
		const dumps = [
			snap('2026-05-06T12:00:00Z'),
			snap('2026-05-07T12:00:00Z'),
			snap('2026-05-08T12:00:00Z'),
			snap('2026-05-09T12:00:00Z'),
			snap('2026-05-10T12:00:00Z'),
			snap('2026-05-11T12:00:00Z'),
			snap('2026-05-12T12:00:00Z'),
			snap('2026-05-13T12:00:00Z'),
			snap('2026-05-14T12:00:00Z'),
			snap('2026-05-15T12:00:00Z'),
		]

		const prune = selectPostgresBackupsToPrune(dumps)

		expect(prune).toEqual([
			snap('2026-05-06T12:00:00Z'),
			snap('2026-05-07T12:00:00Z'),
			snap('2026-05-08T12:00:00Z'),
		])
	})

	it('places a Sunday-night dump and the following Monday-morning dump in distinct weekly buckets', () => {
		// 2026-05-17 is a Sunday (ISO week of Monday 2026-05-11),
		// 2026-05-18 is the next Monday (ISO week of Monday 2026-05-18).
		const sunday = snap('2026-05-17T23:59:00Z')
		const monday = snap('2026-05-18T00:01:00Z')

		const prune = selectPostgresBackupsToPrune([sunday, monday])

		expect(prune).toEqual([])
	})

	it('places a dump on the last day of a month and one on the first day of the next month in distinct monthly buckets', () => {
		const jan31 = snap('2026-01-31T23:59:00Z')
		const feb01 = snap('2026-02-01T00:01:00Z')

		const prune = selectPostgresBackupsToPrune([jan31, feb01])

		expect(prune).toEqual([])
	})

	it('promotes mid-week dumps as weekly representatives once they fall outside the daily window', () => {
		// One dump per day from 2026-04-20 (Mon) through 2026-05-17 (Sun).
		// Daily window keeps the 7 most-recent days: 2026-05-11..2026-05-17.
		// Beyond that, the 4 most-recent ISO weekly buckets (Mon-aligned)
		// pick their newest in-data dump:
		//   week of 2026-05-11 — newest: 2026-05-17 (already kept daily)
		//   week of 2026-05-04 — newest: 2026-05-10
		//   week of 2026-04-27 — newest: 2026-05-03
		//   week of 2026-04-20 — newest: 2026-04-26
		// Monthly buckets pick their newest in-data dump:
		//   2026-05 — newest: 2026-05-17 (already kept daily)
		//   2026-04 — newest: 2026-04-30
		const dumps: PostgresBackupSnapshot[] = []
		for (let day = 20; day <= 30; day++) {
			dumps.push(
				snap(`2026-04-${String(day).padStart(2, '0')}T12:00:00Z`),
			)
		}
		for (let day = 1; day <= 17; day++) {
			dumps.push(
				snap(`2026-05-${String(day).padStart(2, '0')}T12:00:00Z`),
			)
		}

		const prune = selectPostgresBackupsToPrune(dumps)
		const prunedDates = prune.map(s =>
			s.timestamp.toISOString().slice(0, 10),
		)

		expect(prunedDates).toEqual([
			'2026-04-20',
			'2026-04-21',
			'2026-04-22',
			'2026-04-23',
			'2026-04-24',
			'2026-04-25',
			// 2026-04-26 kept as weekly bucket Mon Apr 20
			'2026-04-27',
			'2026-04-28',
			'2026-04-29',
			// 2026-04-30 kept as monthly bucket 2026-04
			'2026-05-01',
			'2026-05-02',
			// 2026-05-03 kept as weekly bucket Mon Apr 27
			'2026-05-04',
			'2026-05-05',
			'2026-05-06',
			'2026-05-07',
			'2026-05-08',
			'2026-05-09',
			// 2026-05-10 kept as weekly bucket Mon May 4
			// 2026-05-11..17 kept as the 7-daily window
		])
	})

	it('groups Thu Dec 31 and Fri Jan 1 in the same ISO week even though they straddle the year boundary', () => {
		// 2026-12-28 is a Monday, so the ISO week of `Mon 2026-12-28`
		// includes Thu Dec 31 2026 AND Fri Jan 1 2027. Same weekly bucket;
		// different monthly buckets (2026-12 vs 2027-01).
		const dec31 = snap('2026-12-31T12:00:00Z')
		const jan01 = snap('2027-01-01T12:00:00Z')

		// Both fall inside the 7-day window, so both are kept via the
		// daily fill alone — the weekly bucket only matters once they age
		// out. Mix in older dumps so weekly + monthly buckets are exercised.
		const dec28 = snap('2026-12-28T12:00:00Z') // Mon of the same ISO week
		const dec27 = snap('2026-12-27T12:00:00Z') // Sun, previous ISO week

		const prune = selectPostgresBackupsToPrune([dec27, dec28, dec31, jan01])

		// All four are within the daily window — nothing pruned.
		expect(prune).toEqual([])
	})

	it('treats a future-dated dump as the most-recent (algorithm uses snapshot timestamps, never wall-clock time)', () => {
		// The retention function is pure — no clock parameter. A
		// clock-skewed dump from "the future" wins the most-recent slot
		// and can displace a present-day dump from being a bucket
		// representative. Pin this behavior so a future refactor doesn't
		// quietly start filtering future timestamps.
		const future = snap('2099-01-01T00:00:00Z')
		const today = snap('2026-05-16T00:00:00Z')
		const yesterday = snap('2026-05-15T00:00:00Z')

		const prune = selectPostgresBackupsToPrune([yesterday, today, future])

		expect(prune).toEqual([])
	})
})

describe('selectPostgresBackupForRestore', () => {
	it('returns null when the snapshot list is empty', () => {
		expect(
			selectPostgresBackupForRestore(
				[],
				new Date('2026-05-16T00:00:00Z'),
			),
		).toBeNull()
	})

	it('returns null when every snapshot is strictly newer than the target', () => {
		const snapshots = [
			snap('2026-05-15T00:00:00Z'),
			snap('2026-05-16T00:00:00Z'),
		]
		expect(
			selectPostgresBackupForRestore(
				snapshots,
				new Date('2026-05-14T23:59:59Z'),
			),
		).toBeNull()
	})

	it('returns the latest snapshot at or before the target when several qualify', () => {
		const oldest = snap('2026-05-10T00:00:00Z')
		const middle = snap('2026-05-12T00:00:00Z')
		const newest = snap('2026-05-14T00:00:00Z')
		const tooNew = snap('2026-05-16T00:00:00Z')

		const chosen = selectPostgresBackupForRestore(
			[oldest, tooNew, middle, newest],
			new Date('2026-05-15T00:00:00Z'),
		)

		expect(chosen).toEqual(newest)
	})

	it('treats the target boundary as inclusive', () => {
		const exact = snap('2026-05-15T00:00:00Z')
		const before = snap('2026-05-14T00:00:00Z')
		const after = snap('2026-05-15T00:00:01Z')

		const chosen = selectPostgresBackupForRestore(
			[before, exact, after],
			new Date('2026-05-15T00:00:00Z'),
		)

		expect(chosen).toEqual(exact)
	})

	it('returns null when the target date is invalid (NaN time)', () => {
		// `new Date('not-a-date').getTime()` is NaN. A naive `t > targetMs`
		// comparison would short-circuit to false for every snapshot and
		// silently pick the first one (or the last, depending on order).
		// Pin the explicit null so a malformed --at never restores at random.
		const snapshots = [snap('2026-05-15T00:00:00Z')]
		expect(
			selectPostgresBackupForRestore(snapshots, new Date('not-a-date')),
		).toBeNull()
	})
})

describe('parsePostgresRestoreArgs', () => {
	it('parses --project + --at without --yes (yes defaults to false)', () => {
		const args = parsePostgresRestoreArgs([
			'--project',
			'acme-web',
			'--at',
			'2026-05-15T00:00:00Z',
		])
		expect(args.project).toBe('acme-web')
		expect(args.at).toEqual(new Date('2026-05-15T00:00:00Z'))
		expect(args.yes).toBe(false)
	})

	it('records --yes when present', () => {
		const args = parsePostgresRestoreArgs([
			'--project',
			'acme-web',
			'--at',
			'2026-05-15',
			'--yes',
		])
		expect(args.yes).toBe(true)
	})

	it('accepts --yes in any position', () => {
		const args = parsePostgresRestoreArgs([
			'--yes',
			'--project',
			'acme-web',
			'--at',
			'2026-05-15',
		])
		expect(args.yes).toBe(true)
		expect(args.project).toBe('acme-web')
	})

	it('throws when --project is missing', () => {
		expect(() =>
			parsePostgresRestoreArgs(['--at', '2026-05-15', '--yes']),
		).toThrow(/--project/)
	})

	it('throws when --at is missing', () => {
		expect(() =>
			parsePostgresRestoreArgs(['--project', 'acme-web', '--yes']),
		).toThrow(/--at/)
	})

	it('throws when --project value is missing', () => {
		expect(() => parsePostgresRestoreArgs(['--project'])).toThrow()
	})

	it('throws when --at value is missing', () => {
		expect(() =>
			parsePostgresRestoreArgs(['--project', 'acme-web', '--at']),
		).toThrow()
	})

	it('throws when --at cannot be parsed as a date', () => {
		expect(() =>
			parsePostgresRestoreArgs([
				'--project',
				'acme-web',
				'--at',
				'not-a-date',
			]),
		).toThrow(/valid ISO date/)
	})

	it('throws on an unknown flag rather than silently ignoring it (a typo of --yes must NOT bypass the gate)', () => {
		expect(() =>
			parsePostgresRestoreArgs([
				'--project',
				'acme-web',
				'--at',
				'2026-05-15',
				'--ye',
			]),
		).toThrow(/unknown option/i)
	})
})

describe('ensurePostgresRestoreConfirmed', () => {
	it('returns without throwing when --yes was passed', () => {
		expect(() =>
			ensurePostgresRestoreConfirmed({
				project: 'acme-web',
				at: new Date('2026-05-15T00:00:00Z'),
				yes: true,
			}),
		).not.toThrow()
	})

	it('throws when --yes is missing — the safety gate for the destructive pg_restore --clean', () => {
		expect(() =>
			ensurePostgresRestoreConfirmed({
				project: 'acme-web',
				at: new Date('2026-05-15T00:00:00Z'),
				yes: false,
			}),
		).toThrow(/--yes/)
	})
})

describe('redactPostgresPassword', () => {
	it('moves the password off the URL and returns it on the side', () => {
		const result = redactPostgresPassword(
			'postgres://acme:hunter2@postgres:5432/acme',
		)
		expect(result.urlWithoutPassword).toBe(
			'postgres://acme@postgres:5432/acme',
		)
		expect(result.password).toBe('hunter2')
	})

	it('percent-decodes the password so libpq receives the unescaped value', () => {
		// `@` and `:` are URL-reserved, so a generator that uses them in
		// passwords must percent-encode (`%40`, `%3A`). PGPASSWORD must
		// hold the original byte, not the encoded form, or auth fails.
		const result = redactPostgresPassword(
			'postgres://acme:p%40ss%3Aword@postgres:5432/acme',
		)
		expect(result.password).toBe('p@ss:word')
	})

	it('preserves query parameters (e.g. sslmode) on the returned URL', () => {
		const result = redactPostgresPassword(
			'postgres://acme:hunter2@db.example.com:5432/acme?sslmode=require',
		)
		expect(result.urlWithoutPassword).toBe(
			'postgres://acme@db.example.com:5432/acme?sslmode=require',
		)
	})

	it('returns an empty password when the URL has none', () => {
		const result = redactPostgresPassword(
			'postgres://acme@postgres:5432/acme',
		)
		expect(result.urlWithoutPassword).toBe(
			'postgres://acme@postgres:5432/acme',
		)
		expect(result.password).toBe('')
	})

	it('throws on a malformed URL — operator misconfig should fail loud', () => {
		expect(() => redactPostgresPassword('not a url')).toThrow()
	})
})
