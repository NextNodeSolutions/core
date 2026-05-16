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
	postgresBackupBucketName,
	postgresProjectIdentifier,
} from './postgres.ts'

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
	it('returns a sidecar spec when mode is embedded', () => {
		const result = buildPostgresSidecar(
			{ mode: 'embedded', version: '17.2', migrationsFolder: undefined },
			'acme-web',
		)

		expect(result).not.toBeNull()
		if (result === null) return
		expect(result.image).toBe('postgres:17.2')
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
			{ mode: 'external', version: '16', migrationsFolder: undefined },
			'acme-web',
		)

		expect(result).toBeNull()
	})

	it('threads the major-only version into the image tag', () => {
		const result = buildPostgresSidecar(
			{ mode: 'embedded', version: '16', migrationsFolder: undefined },
			'acme-web',
		)

		expect(result?.image).toBe('postgres:16')
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
			{ mode: 'external', version: '17.2', migrationsFolder: undefined },
			'acme-web',
		)

		expect(result).toBeNull()
	})

	it('builds an eeshugerman/postgres-backup-s3 sidecar pinned to the postgres major', () => {
		const result = buildPostgresBackupSidecar(
			{ mode: 'embedded', version: '17.2', migrationsFolder: undefined },
			'acme-web',
		)

		expect(result).not.toBeNull()
		if (result === null) return
		expect(result.image).toBe('eeshugerman/postgres-backup-s3:17')
		expect(result.restart).toBe('unless-stopped')
		expect(result.depends_on).toEqual([POSTGRES_SIDECAR_SERVICE_NAME])
	})

	it('pins the image to a bare major when version is already major-only', () => {
		const result = buildPostgresBackupSidecar(
			{ mode: 'embedded', version: '16', migrationsFolder: undefined },
			'acme-web',
		)

		expect(result?.image).toBe('eeshugerman/postgres-backup-s3:16')
	})

	it('renames the project-level R2 creds to the S3_* names the image expects via compose interpolation', () => {
		const result = buildPostgresBackupSidecar(
			{ mode: 'embedded', version: '17.2', migrationsFolder: undefined },
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
			{ mode: 'embedded', version: '17.2', migrationsFolder: undefined },
			'acme-web',
		)

		expect(result?.environment['S3_BUCKET']).toBe('nn-backups-acme-web')
		expect(result?.environment['S3_PREFIX']).toBe(POSTGRES_BACKUP_PREFIX)
	})

	it('runs the dump on the canonical daily schedule with retention disabled (handled separately)', () => {
		const result = buildPostgresBackupSidecar(
			{ mode: 'embedded', version: '17.2', migrationsFolder: undefined },
			'acme-web',
		)

		expect(result?.environment['SCHEDULE']).toBe(POSTGRES_BACKUP_SCHEDULE)
		expect(result?.environment['BACKUP_KEEP_DAYS']).toBe('0')
	})

	it('connects to the in-network postgres sidecar with the project-scoped role+db', () => {
		const result = buildPostgresBackupSidecar(
			{ mode: 'embedded', version: '17.2', migrationsFolder: undefined },
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
