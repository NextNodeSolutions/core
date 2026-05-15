import { describe, expect, it } from 'vitest'

import {
	POSTGRES_DATA_DIR,
	POSTGRES_DATA_VOLUME,
	buildPostgresEmbeddedDatabaseUrl,
	buildPostgresEmbeddedEnv,
	buildPostgresExternalEnv,
	buildPostgresSidecar,
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
			{ mode: 'embedded', version: '17.2' },
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
			{ mode: 'external', version: '16' },
			'acme-web',
		)

		expect(result).toBeNull()
	})

	it('threads the major-only version into the image tag', () => {
		const result = buildPostgresSidecar(
			{ mode: 'embedded', version: '16' },
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
