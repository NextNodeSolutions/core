import { describe, expect, it } from 'vitest'

import {
	NEXTNODE_POSTGRES_WALG_IMAGE,
	buildPostgresSidecar,
	buildPostgresWalgSidecar,
} from './postgres-walg.ts'
import {
	POSTGRES_DATA_DIR,
	POSTGRES_DATA_VOLUME,
	POSTGRES_SIDECAR_SERVICE_NAME,
} from './postgres.ts'

describe('buildPostgresSidecar', () => {
	it('uses the fleet wal-g image and enables WAL archiving in production', () => {
		const sidecar = buildPostgresSidecar(
			{ mode: 'embedded' },
			'acme-web',
			'production',
		)

		expect(sidecar).not.toBeNull()
		if (sidecar === null) return
		expect(sidecar.image).toBe(NEXTNODE_POSTGRES_WALG_IMAGE)
		expect(sidecar.image).toBe('ghcr.io/nextnodesolutions/postgres-walg:18')
		expect(sidecar.restart).toBe('unless-stopped')
		expect(sidecar.env_file).toEqual(['.env'])
		expect(sidecar.volumes).toEqual([
			`${POSTGRES_DATA_VOLUME}:${POSTGRES_DATA_DIR}`,
		])
		expect(sidecar.healthcheck.test).toEqual([
			'CMD-SHELL',
			'pg_isready -U acme_web -d acme_web',
		])
		expect(sidecar.command).toContain('archive_mode=on')
		expect(sidecar.command).toContain('archive_command=wal-g wal-push %p')
		expect(sidecar.command).toContain('archive_timeout=180')
		expect(sidecar.environment?.['WALG_S3_PREFIX']).toBe(
			's3://nn-walg-acme-web',
		)
	})

	it('runs no archiving in development - the wal-g entrypoint is a no-op there', () => {
		const sidecar = buildPostgresSidecar(
			{ mode: 'embedded' },
			'acme-web',
			'development',
		)

		expect(sidecar).not.toBeNull()
		if (sidecar === null) return
		expect(sidecar.image).toBe(NEXTNODE_POSTGRES_WALG_IMAGE)
		expect(sidecar.command).toBeUndefined()
		expect(sidecar.environment).toBeUndefined()
	})

	it('returns null when mode is external', () => {
		expect(
			buildPostgresSidecar(
				{ mode: 'external' },
				'acme-web',
				'production',
			),
		).toBeNull()
	})
})

describe('buildPostgresWalgSidecar', () => {
	it('returns null when mode is external (user-owned DB)', () => {
		expect(
			buildPostgresWalgSidecar(
				{ mode: 'external' },
				'acme-web',
				'production',
			),
		).toBeNull()
	})

	it('returns null in development - zero backups in dev', () => {
		expect(
			buildPostgresWalgSidecar(
				{ mode: 'embedded' },
				'acme-web',
				'development',
			),
		).toBeNull()
	})

	it('builds a wal-g base-backup loop on the fleet image in production', () => {
		const sidecar = buildPostgresWalgSidecar(
			{ mode: 'embedded' },
			'acme-web',
			'production',
		)

		expect(sidecar).not.toBeNull()
		if (sidecar === null) return
		expect(sidecar.image).toBe(NEXTNODE_POSTGRES_WALG_IMAGE)
		expect(sidecar.restart).toBe('unless-stopped')
		expect(sidecar.depends_on).toEqual([POSTGRES_SIDECAR_SERVICE_NAME])
		expect(sidecar.command).toEqual(['walg-backup-loop.sh'])
		expect(sidecar.volumes).toEqual([
			`${POSTGRES_DATA_VOLUME}:${POSTGRES_DATA_DIR}:ro`,
		])
	})

	it('shares the wal-g R2 config and connects to the in-network postgres', () => {
		const sidecar = buildPostgresWalgSidecar(
			{ mode: 'embedded' },
			'acme-web',
			'production',
		)

		expect(sidecar?.environment).toMatchObject({
			WALG_S3_PREFIX: 's3://nn-walg-acme-web',
			AWS_ACCESS_KEY_ID: '${R2_ACCESS_KEY_ID}',
			AWS_SECRET_ACCESS_KEY: '${R2_SECRET_ACCESS_KEY}',
			AWS_ENDPOINT: '${R2_ENDPOINT}',
			AWS_S3_FORCE_PATH_STYLE: 'true',
			PGHOST: POSTGRES_SIDECAR_SERVICE_NAME,
			PGUSER: 'acme_web',
			PGDATABASE: 'acme_web',
			PGPASSWORD: '${POSTGRES_PASSWORD}',
		})
	})
})
