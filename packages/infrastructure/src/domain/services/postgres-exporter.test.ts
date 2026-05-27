import { describe, expect, it } from 'vitest'

import {
	POSTGRES_EXPORTER_DSN_ENV,
	POSTGRES_EXPORTER_IMAGE,
	POSTGRES_EXPORTER_INIT_FILENAME,
	POSTGRES_EXPORTER_INIT_MOUNT_PATH,
	POSTGRES_EXPORTER_PASSWORD_ENV,
	POSTGRES_EXPORTER_PORT,
	POSTGRES_EXPORTER_SERVICE_NAME,
	POSTGRES_EXPORTER_USER,
	SUPABASE_DB_SERVICE_NAME,
	SUPABASE_DEFAULT_DATABASE,
	TAILSCALE_IP_ENV,
	buildPostgresExporterDsn,
	buildPostgresExporterSidecar,
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

	it('mounts the bootstrap script with a 00- prefix so it runs before supabase initdb scripts', () => {
		expect(POSTGRES_EXPORTER_INIT_FILENAME).toBe('00-pg-monitor.sql')
		expect(POSTGRES_EXPORTER_INIT_MOUNT_PATH).toBe(
			'/docker-entrypoint-initdb.d/00-pg-monitor.sql',
		)
	})

	it('uses the upstream supabase service name for the database container', () => {
		expect(SUPABASE_DB_SERVICE_NAME).toBe('db')
	})

	it('defaults the database name to the supabase initdb target', () => {
		expect(SUPABASE_DEFAULT_DATABASE).toBe('postgres')
	})

	it('names the sidecar after the role it runs', () => {
		expect(POSTGRES_EXPORTER_SERVICE_NAME).toBe('postgres-exporter')
		expect(POSTGRES_EXPORTER_USER).toBe('postgres_exporter')
	})
})

describe('buildPostgresExporterDsn', () => {
	it('renders the DSN reaching the supabase db service over the internal compose network', () => {
		expect(buildPostgresExporterDsn('hunter2')).toBe(
			'postgresql://postgres_exporter:hunter2@db:5432/postgres?sslmode=disable',
		)
	})

	it('passes a compose ${VAR} interpolation through unchanged so the sidecar can read the password from .env', () => {
		expect(buildPostgresExporterDsn('${PG_EXPORTER_PASSWORD}')).toBe(
			'postgresql://postgres_exporter:${PG_EXPORTER_PASSWORD}@db:5432/postgres?sslmode=disable',
		)
	})

	it('preserves an empty password slot when the caller passes an empty string', () => {
		expect(buildPostgresExporterDsn('')).toBe(
			'postgresql://postgres_exporter:@db:5432/postgres?sslmode=disable',
		)
	})
})

describe('buildPostgresExporterSidecar', () => {
	it('pins the sidecar image and restart policy to the module constants', () => {
		const sidecar = buildPostgresExporterSidecar()

		expect(sidecar.image).toBe(POSTGRES_EXPORTER_IMAGE)
		expect(sidecar.restart).toBe('unless-stopped')
	})

	it('depends on the supabase db service so the exporter only starts after the database', () => {
		expect(buildPostgresExporterSidecar().depends_on).toEqual([
			SUPABASE_DB_SERVICE_NAME,
		])
	})

	it('binds the exporter port to the VPS tailscale interface via compose env interpolation', () => {
		expect(buildPostgresExporterSidecar().ports).toEqual([
			`\${${TAILSCALE_IP_ENV}}:${String(POSTGRES_EXPORTER_PORT)}:${String(POSTGRES_EXPORTER_PORT)}`,
		])
	})

	it('threads the DSN through DATA_SOURCE_NAME with the per-project password env interpolated at compose-up', () => {
		expect(buildPostgresExporterSidecar().environment).toEqual({
			[POSTGRES_EXPORTER_DSN_ENV]: `postgresql://${POSTGRES_EXPORTER_USER}:\${${POSTGRES_EXPORTER_PASSWORD_ENV}}@${SUPABASE_DB_SERVICE_NAME}:5432/${SUPABASE_DEFAULT_DATABASE}?sslmode=disable`,
		})
	})
})

describe('renderPostgresExporterBootstrapSql', () => {
	it('creates the exporter role with the supplied password literal', () => {
		const sql = renderPostgresExporterBootstrapSql('hunter2')

		expect(sql).toContain(
			"CREATE ROLE postgres_exporter WITH LOGIN PASSWORD 'hunter2'",
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
