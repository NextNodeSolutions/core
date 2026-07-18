import { describe, expect, it } from 'vitest'

import {
	POSTGRES_EXPORTER_EMBEDDED_PASSWORD_ENV,
	POSTGRES_EXPORTER_IMAGE,
	POSTGRES_EXPORTER_INIT_FILENAME,
	POSTGRES_EXPORTER_INIT_HOST_PATH,
	POSTGRES_EXPORTER_INIT_MOUNT_PATH,
	POSTGRES_EXPORTER_PASS_ENV,
	POSTGRES_EXPORTER_PORT,
	POSTGRES_EXPORTER_SERVICE_NAME,
	POSTGRES_EXPORTER_URI_ENV,
	POSTGRES_EXPORTER_USER,
	POSTGRES_EXPORTER_USER_ENV,
	TAILSCALE_IP_ENV,
	buildEmbeddedPostgresExporterSidecar,
	buildPostgresExporterInitMount,
	renderPostgresExporterBootstrapSql,
} from './postgres-exporter.ts'

describe('postgres-exporter constants', () => {
	it('pins the exporter to a tagged release on the quay.io community registry', () => {
		expect(POSTGRES_EXPORTER_IMAGE).toMatch(
			/^quay\.io\/prometheuscommunity\/postgres-exporter:v\d+\.\d+\.\d+$/,
		)
	})

	it('exposes the prometheus community postgres_exporter default port', () => {
		expect(POSTGRES_EXPORTER_PORT).toBe(9187)
	})

	it('mounts the bootstrap script with a 00- prefix so it runs before the image initdb scripts', () => {
		expect(POSTGRES_EXPORTER_INIT_FILENAME).toBe('00-pg-monitor.sql')
		expect(POSTGRES_EXPORTER_INIT_MOUNT_PATH).toBe(
			'/docker-entrypoint-initdb.d/00-pg-monitor.sql',
		)
	})

	it('resolves the host-side bootstrap path relative to the compose file directory', () => {
		expect(POSTGRES_EXPORTER_INIT_HOST_PATH).toBe('./00-pg-monitor.sql')
	})

	it('names the sidecar after the role it runs', () => {
		expect(POSTGRES_EXPORTER_SERVICE_NAME).toBe('postgres-exporter')
		expect(POSTGRES_EXPORTER_USER).toBe('postgres_exporter')
	})
})

describe('buildEmbeddedPostgresExporterSidecar', () => {
	const sidecar = buildEmbeddedPostgresExporterSidecar(
		'postgres',
		5432,
		'acme_web',
	)

	it('pins the sidecar image and restart policy to the module constants', () => {
		expect(sidecar.image).toBe(POSTGRES_EXPORTER_IMAGE)
		expect(sidecar.restart).toBe('unless-stopped')
	})

	it('depends on the embedded postgres service so the exporter only starts after the database', () => {
		expect(sidecar.depends_on).toEqual(['postgres'])
	})

	it('binds the exporter port to the VPS tailscale interface via compose env interpolation', () => {
		expect(sidecar.ports).toEqual([
			`\${${TAILSCALE_IP_ENV}}:${String(POSTGRES_EXPORTER_PORT)}:${String(POSTGRES_EXPORTER_PORT)}`,
		])
	})

	it('splits the connection across DATA_SOURCE_URI/USER/PASS so a URL-unsafe POSTGRES_PASSWORD never lands in URL userinfo', () => {
		// The embedded exporter reuses POSTGRES_PASSWORD, which can be any byte
		// string (e.g. a base64 secret inherited from a prior stack). Carrying
		// it in the discrete DATA_SOURCE_PASS field - not a DSN URL - means
		// `/ @ : ? +` never mis-parse and no percent-encoding is needed.
		expect(sidecar.environment).toEqual({
			[POSTGRES_EXPORTER_URI_ENV]:
				'postgres:5432/acme_web?sslmode=disable',
			[POSTGRES_EXPORTER_USER_ENV]: POSTGRES_EXPORTER_USER,
			[POSTGRES_EXPORTER_PASS_ENV]: `\${${POSTGRES_EXPORTER_EMBEDDED_PASSWORD_ENV}}`,
		})
	})
})

describe('buildPostgresExporterInitMount', () => {
	it('binds the host-side bootstrap SQL into /docker-entrypoint-initdb.d/ on the db container as read-only', () => {
		expect(buildPostgresExporterInitMount()).toBe(
			`${POSTGRES_EXPORTER_INIT_HOST_PATH}:${POSTGRES_EXPORTER_INIT_MOUNT_PATH}:ro`,
		)
	})

	it('uses the canonical 00-pg-monitor.sql filename on both sides of the mount', () => {
		const mount = buildPostgresExporterInitMount()

		expect(mount).toContain(POSTGRES_EXPORTER_INIT_FILENAME)
		expect(mount.split(':')[1]).toContain('00-pg-monitor.sql')
	})
})

describe('renderPostgresExporterBootstrapSql', () => {
	it('creates the exporter role with the supplied password literal', () => {
		const sql = renderPostgresExporterBootstrapSql('hunter2')

		expect(sql).toContain(
			"ALTER ROLE postgres_exporter WITH LOGIN PASSWORD 'hunter2'",
		)
	})

	it('grants pg_monitor to the exporter role and never SUPERUSER', () => {
		const sql = renderPostgresExporterBootstrapSql('hunter2')

		expect(sql).toContain('GRANT pg_monitor TO postgres_exporter;')
		expect(sql).not.toMatch(/SUPERUSER/i)
	})

	it('wraps the CREATE ROLE in an IF NOT EXISTS guard so a manual re-run is safe', () => {
		const sql = renderPostgresExporterBootstrapSql('hunter2')

		expect(sql).toContain(
			"IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres_exporter')",
		)
	})

	it('produces deterministic output for the same input', () => {
		expect(renderPostgresExporterBootstrapSql('s3cret')).toBe(
			renderPostgresExporterBootstrapSql('s3cret'),
		)
	})
})
