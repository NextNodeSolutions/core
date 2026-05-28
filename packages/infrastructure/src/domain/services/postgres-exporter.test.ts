import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
	POSTGRES_EXPORTER_DSN_ENV,
	POSTGRES_EXPORTER_IMAGE,
	POSTGRES_EXPORTER_INIT_FILENAME,
	POSTGRES_EXPORTER_INIT_HOST_PATH,
	POSTGRES_EXPORTER_INIT_MOUNT_PATH,
	POSTGRES_EXPORTER_PASSWORD_ENV,
	POSTGRES_EXPORTER_PORT,
	POSTGRES_EXPORTER_QUERIES_ENV,
	POSTGRES_EXPORTER_QUERIES_FILENAME,
	POSTGRES_EXPORTER_QUERIES_HOST_PATH,
	POSTGRES_EXPORTER_QUERIES_MOUNT_PATH,
	POSTGRES_EXPORTER_SERVICE_NAME,
	POSTGRES_EXPORTER_TOP_QUERIES_LIMIT,
	POSTGRES_EXPORTER_USER,
	TAILSCALE_IP_ENV,
	buildPostgresExporterDsn,
	buildPostgresExporterInitMount,
	buildPostgresExporterQueriesMount,
	buildPostgresExporterSidecar,
	renderPostgresExporterBootstrapSql,
	renderPostgresExporterQueriesYaml,
} from './postgres-exporter.ts'
import {
	SUPABASE_DB_SERVICE_NAME,
	SUPABASE_DEFAULT_DATABASE,
} from './supabase.ts'

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

	it('resolves the host-side bootstrap path relative to the compose file directory', () => {
		expect(POSTGRES_EXPORTER_INIT_HOST_PATH).toBe('./00-pg-monitor.sql')
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
			[POSTGRES_EXPORTER_QUERIES_ENV]:
				POSTGRES_EXPORTER_QUERIES_MOUNT_PATH,
		})
	})

	it('bind-mounts the custom queries YAML into the exporter container as read-only', () => {
		expect(buildPostgresExporterSidecar().volumes).toEqual([
			buildPostgresExporterQueriesMount(),
		])
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

describe('postgres-exporter custom-queries constants', () => {
	it('uses the upstream PG_EXPORTER_EXTEND_QUERY_PATH env var so the exporter discovers the YAML', () => {
		expect(POSTGRES_EXPORTER_QUERIES_ENV).toBe(
			'PG_EXPORTER_EXTEND_QUERY_PATH',
		)
	})

	it('persists the queries YAML next to compose.yaml on the host under a kebab-case filename', () => {
		expect(POSTGRES_EXPORTER_QUERIES_FILENAME).toBe(
			'pg-exporter-queries.yaml',
		)
		expect(POSTGRES_EXPORTER_QUERIES_HOST_PATH).toBe(
			'./pg-exporter-queries.yaml',
		)
	})

	it('mounts the queries YAML at a stable path outside any image-managed directory', () => {
		expect(POSTGRES_EXPORTER_QUERIES_MOUNT_PATH).toBe(
			'/etc/postgres_exporter/queries.yaml',
		)
	})

	it('caps per-statement series at 50 so cardinality stays bounded regardless of cluster traffic', () => {
		expect(POSTGRES_EXPORTER_TOP_QUERIES_LIMIT).toBe(50)
	})
})

describe('buildPostgresExporterQueriesMount', () => {
	it('binds the host-side queries YAML to the in-container path as read-only', () => {
		expect(buildPostgresExporterQueriesMount()).toBe(
			`${POSTGRES_EXPORTER_QUERIES_HOST_PATH}:${POSTGRES_EXPORTER_QUERIES_MOUNT_PATH}:ro`,
		)
	})
})

describe('renderPostgresExporterQueriesYaml', () => {
	it('parses as valid YAML with exactly two metric sets - top-statements + global aggregates', () => {
		const parsed = parse(renderPostgresExporterQueriesYaml())

		expect(Object.keys(parsed)).toEqual([
			'pg_stat_statements_top',
			'pg_stat_statements_global',
		])
	})

	it('caps the per-statement metric set with the module limit so cardinality is bounded', () => {
		const yaml = renderPostgresExporterQueriesYaml()

		expect(yaml).toContain(
			`LIMIT ${String(POSTGRES_EXPORTER_TOP_QUERIES_LIMIT)};`,
		)
		expect(yaml).toContain('ORDER BY total_exec_time DESC')
	})

	it('labels each top statement with sha256(normalized_statement)[0:16] + first 80 chars - bounded length, PII-safe', () => {
		const yaml = renderPostgresExporterQueriesYaml()

		expect(yaml).toContain(
			"substring(encode(digest(query, 'sha256'), 'hex'), 1, 16) || '_' || substring(query, 1, 80) AS query",
		)
	})

	it('declares the top-statement columns with the correct prometheus usage types', () => {
		const parsed = parse(renderPostgresExporterQueriesYaml())

		expect(parsed.pg_stat_statements_top.metrics).toEqual([
			{
				query: {
					usage: 'LABEL',
					description:
						'sha256(normalized_statement)[0:16]_<first 80 chars>',
				},
			},
			{
				calls: {
					usage: 'COUNTER',
					description:
						'Total number of times the statement was executed',
				},
			},
			{
				total_exec_time: {
					usage: 'COUNTER',
					description:
						'Total time spent in the statement in milliseconds',
				},
			},
			{
				mean_exec_time: {
					usage: 'GAUGE',
					description:
						'Mean time spent per execution in milliseconds',
				},
			},
			{
				rows: {
					usage: 'COUNTER',
					description:
						'Total rows retrieved or affected by the statement',
				},
			},
		])
	})

	it('exposes global aggregates - total calls/rows/exec-time as counters and p95 mean_exec_time as gauge', () => {
		const parsed = parse(renderPostgresExporterQueriesYaml())

		expect(parsed.pg_stat_statements_global.metrics).toEqual([
			{
				total_calls: {
					usage: 'COUNTER',
					description: 'Cluster-wide sum of statement executions',
				},
			},
			{
				total_rows: {
					usage: 'COUNTER',
					description:
						'Cluster-wide sum of rows retrieved or affected',
				},
			},
			{
				total_exec_time_ms: {
					usage: 'COUNTER',
					description:
						'Cluster-wide cumulative execution time in milliseconds',
				},
			},
			{
				mean_exec_time_p95_ms: {
					usage: 'GAUGE',
					description:
						'p95 of per-statement mean execution time in milliseconds',
				},
			},
		])
		expect(parsed.pg_stat_statements_global.query).toContain(
			'percentile_cont(0.95) WITHIN GROUP (ORDER BY mean_exec_time)',
		)
	})

	it('produces deterministic output across calls', () => {
		expect(renderPostgresExporterQueriesYaml()).toBe(
			renderPostgresExporterQueriesYaml(),
		)
	})
})
