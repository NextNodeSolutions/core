import {
	POSTGRES_EXPORTER_DSN_ENV,
	POSTGRES_EXPORTER_IMAGE,
	POSTGRES_EXPORTER_INIT_HOST_PATH,
	POSTGRES_EXPORTER_INIT_MOUNT_PATH,
	POSTGRES_EXPORTER_PASSWORD_ENV,
	POSTGRES_EXPORTER_PORT,
	POSTGRES_EXPORTER_SERVICE_NAME,
	POSTGRES_EXPORTER_USER,
	TAILSCALE_IP_ENV,
	buildPostgresExporterDsn,
	buildPostgresExporterInitMount,
} from '#/domain/services/postgres-exporter.ts'
import {
	POSTGRES_DATA_DIR,
	POSTGRES_DATA_VOLUME,
} from '#/domain/services/postgres.ts'
import {
	SUPABASE_AUTH_IMAGE,
	SUPABASE_BACKUP_IMAGE,
	SUPABASE_BACKUP_INTERVAL_SECONDS,
	SUPABASE_BACKUP_SERVICE_NAME,
	SUPABASE_DB_DATA_DIR,
	SUPABASE_DB_DATA_VOLUME,
	SUPABASE_KONG_IMAGE,
	SUPABASE_POSTGRES_IMAGE,
	SUPABASE_REALTIME_IMAGE,
	SUPABASE_STORAGE_IMAGE,
	SUPABASE_STUDIO_IMAGE,
} from '#/domain/services/supabase.ts'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
	CONTAINER_PORT,
	formatImageRef,
	renderComposeFile,
} from './compose-file.ts'

import type { ImageRef } from '#/domain/deploy/target.ts'

const IMAGE: ImageRef = {
	registry: 'ghcr.io',
	repository: 'acme/web',
	tag: 'sha-abc123',
}

const PROJECT_NAME = 'acme-web'
const ENVIRONMENT = 'production'

describe('CONTAINER_PORT', () => {
	it('is the single source of truth for the app listening port', () => {
		expect(CONTAINER_PORT).toBe(3000)
	})
})

describe('formatImageRef', () => {
	it('joins registry, repository, and tag', () => {
		expect(formatImageRef(IMAGE)).toBe('ghcr.io/acme/web:sha-abc123')
	})

	it('handles Docker Hub style refs', () => {
		expect(
			formatImageRef({
				registry: 'docker.io',
				repository: 'library/nginx',
				tag: 'latest',
			}),
		).toBe('docker.io/library/nginx:latest')
	})

	it('handles nested repository paths', () => {
		expect(
			formatImageRef({
				registry: 'ghcr.io',
				repository: 'org/team/service',
				tag: 'v1.2.3',
			}),
		).toBe('ghcr.io/org/team/service:v1.2.3')
	})
})

describe('renderComposeFile', () => {
	it('produces valid compose YAML with image and port mapping', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
			postgres: undefined,
		})
		const parsed = parse(result)

		expect(parsed).toEqual({
			services: {
				app: {
					image: 'ghcr.io/acme/web:sha-abc123',
					restart: 'unless-stopped',
					env_file: ['.env'],
					ports: [`127.0.0.1:8080:${CONTAINER_PORT}`],
				},
			},
		})
	})

	it('binds to 127.0.0.1 only', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8081,
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
			postgres: undefined,
		})
		const parsed = parse(result)

		expect(parsed.services.app.ports[0]).toMatch(/^127\.0\.0\.1:8081:/)
	})

	it('uses CONTAINER_PORT as the container-side port', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
			postgres: undefined,
		})
		const parsed = parse(result)

		expect(parsed.services.app.ports[0]).toBe(
			`127.0.0.1:8080:${CONTAINER_PORT}`,
		)
	})

	it('uses the full image ref in the image field', () => {
		const result = renderComposeFile({
			image: {
				registry: 'registry.example.com',
				repository: 'team/app',
				tag: 'v2.0.0',
			},
			hostPort: 8080,
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
			postgres: undefined,
		})
		const parsed = parse(result)

		expect(parsed.services.app.image).toBe(
			'registry.example.com/team/app:v2.0.0',
		)
	})

	it('omits volumes keys when no volumes are provided', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
			postgres: undefined,
		})
		const parsed = parse(result)

		expect(parsed.services.app).not.toHaveProperty('volumes')
		expect(parsed).not.toHaveProperty('volumes')
	})

	it('omits volumes keys when an empty volumes array is provided', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			volumes: [],
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
			postgres: undefined,
		})
		const parsed = parse(result)

		expect(parsed.services.app).not.toHaveProperty('volumes')
		expect(parsed).not.toHaveProperty('volumes')
	})

	it('renders the same YAML with no volumes as without the field', () => {
		const without = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
			postgres: undefined,
		})
		const withEmpty = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			volumes: [],
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
			postgres: undefined,
		})

		expect(withEmpty).toBe(without)
	})

	it('emits service.volumes mounts and a top-level named volume when provided', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			volumes: [{ name: 'data', mount: '/var/lib/app' }],
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
			postgres: undefined,
		})
		const parsed = parse(result)

		expect(parsed.services.app.volumes).toEqual(['data:/var/lib/app'])
		expect(parsed.volumes).toEqual({ data: {} })
	})

	it('emits multiple volumes preserving order', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			volumes: [
				{ name: 'data', mount: '/var/lib/app' },
				{ name: 'cache', mount: '/var/cache/app' },
			],
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
			postgres: undefined,
		})
		const parsed = parse(result)

		expect(parsed.services.app.volumes).toEqual([
			'data:/var/lib/app',
			'cache:/var/cache/app',
		])
		expect(parsed.volumes).toEqual({ data: {}, cache: {} })
	})

	it('keeps image, restart, env_file, and ports unchanged when volumes are added', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			volumes: [{ name: 'data', mount: '/var/lib/app' }],
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
			postgres: undefined,
		})
		const parsed = parse(result)

		expect(parsed.services.app.image).toBe('ghcr.io/acme/web:sha-abc123')
		expect(parsed.services.app.restart).toBe('unless-stopped')
		expect(parsed.services.app.env_file).toEqual(['.env'])
		expect(parsed.services.app.ports).toEqual([
			`127.0.0.1:8080:${CONTAINER_PORT}`,
		])
	})

	it('emits a postgres sidecar when services.postgres.mode is embedded', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			postgres: {
				mode: 'embedded',
			},
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
		})
		const parsed = parse(result)

		expect(parsed.services.postgres).toEqual({
			image: 'postgres:18',
			restart: 'unless-stopped',
			env_file: ['.env'],
			volumes: [`${POSTGRES_DATA_VOLUME}:${POSTGRES_DATA_DIR}`],
			healthcheck: {
				test: ['CMD-SHELL', 'pg_isready -U acme_web -d acme_web'],
				interval: '10s',
				timeout: '5s',
				retries: 5,
			},
		})
		expect(parsed.volumes).toEqual({ [POSTGRES_DATA_VOLUME]: {} })
	})

	it('does not expose postgres on a host port', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			postgres: {
				mode: 'embedded',
			},
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
		})
		const parsed = parse(result)

		expect(parsed.services.postgres).not.toHaveProperty('ports')
	})

	it('omits the postgres sidecar when mode is external', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			postgres: {
				mode: 'external',
			},
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
		})
		const parsed = parse(result)

		expect(parsed.services).not.toHaveProperty('postgres')
		expect(parsed.services).not.toHaveProperty('postgres-backup')
		expect(parsed).not.toHaveProperty('volumes')
	})

	it('emits a postgres-backup sidecar when postgres is embedded', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			postgres: {
				mode: 'embedded',
			},
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
		})
		const parsed = parse(result)

		expect(parsed.services['postgres-backup']).toEqual({
			image: 'ghcr.io/solectrus/postgres-s3-backup:18',
			restart: 'unless-stopped',
			depends_on: ['postgres'],
			environment: {
				SCHEDULE: '@daily',
				BACKUP_KEEP_DAYS: '0',
				S3_REGION: 'auto',
				S3_ACCESS_KEY_ID: '${R2_ACCESS_KEY_ID}',
				S3_SECRET_ACCESS_KEY: '${R2_SECRET_ACCESS_KEY}',
				S3_ENDPOINT: '${R2_ENDPOINT}',
				S3_BUCKET: 'nn-backups-acme-web',
				S3_PREFIX: 'postgres',
				S3_S3V4: 'yes',
				POSTGRES_HOST: 'postgres',
				POSTGRES_DATABASE: 'acme_web',
				POSTGRES_USER: 'acme_web',
				POSTGRES_PASSWORD: '${POSTGRES_PASSWORD}',
			},
		})
	})

	it('does not expose postgres-backup on a host port', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			postgres: {
				mode: 'embedded',
			},
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
		})
		const parsed = parse(result)

		expect(parsed.services['postgres-backup']).not.toHaveProperty('ports')
	})

	it('merges the postgres-data volume with user-declared volumes', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			volumes: [{ name: 'app-data', mount: '/var/lib/app' }],
			postgres: {
				mode: 'embedded',
			},
			projectName: PROJECT_NAME,
			environment: ENVIRONMENT,
		})
		const parsed = parse(result)

		expect(parsed.volumes).toEqual({
			'app-data': {},
			[POSTGRES_DATA_VOLUME]: {},
		})
	})
})

describe('renderComposeFile - postgres service wiring', () => {
	const baseInput = {
		image: IMAGE,
		hostPort: 8080,
		projectName: PROJECT_NAME,
		environment: ENVIRONMENT,
	} as const

	it('renders both postgres and postgres-backup sidecars in embedded mode', () => {
		const result = renderComposeFile({
			...baseInput,
			postgres: {
				mode: 'embedded',
			},
		})
		const parsed = parse(result)

		expect(Object.keys(parsed.services)).toEqual([
			'app',
			'postgres',
			'postgres-backup',
		])
		expect(parsed.volumes).toEqual({ [POSTGRES_DATA_VOLUME]: {} })
	})

	it('renders no postgres-related services or volumes when postgres config is undefined', () => {
		const result = renderComposeFile({
			...baseInput,
			postgres: undefined,
		})
		const parsed = parse(result)

		expect(Object.keys(parsed.services)).toEqual(['app'])
		expect(parsed).not.toHaveProperty('volumes')
	})

	it('renders no postgres sidecars when postgres mode is external', () => {
		const result = renderComposeFile({
			...baseInput,
			postgres: {
				mode: 'external',
			},
		})
		const parsed = parse(result)

		expect(Object.keys(parsed.services)).toEqual(['app'])
		expect(parsed).not.toHaveProperty('volumes')
	})

	it('declares app depends_on postgres service_healthy when postgres is embedded', () => {
		const result = renderComposeFile({
			...baseInput,
			postgres: {
				mode: 'embedded',
			},
		})
		const parsed = parse(result)

		expect(parsed.services.app.depends_on).toEqual({
			postgres: { condition: 'service_healthy' },
		})
	})

	it('omits app depends_on when postgres mode is external', () => {
		const result = renderComposeFile({
			...baseInput,
			postgres: {
				mode: 'external',
			},
		})
		const parsed = parse(result)

		expect(parsed.services.app).not.toHaveProperty('depends_on')
	})
})

describe('renderComposeFile - supabase service wiring', () => {
	const baseInput = {
		image: IMAGE,
		hostPort: 8080,
		projectName: PROJECT_NAME,
		environment: ENVIRONMENT,
		postgres: undefined,
	} as const

	it('renders the full self-host stack (db + auth + realtime + storage + kong + studio) plus the postgres-exporter and supabase-backup sidecars when services.supabase is declared', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(Object.keys(parsed.services)).toEqual([
			'app',
			'db',
			'auth',
			'realtime',
			'storage',
			'kong',
			'studio',
			POSTGRES_EXPORTER_SERVICE_NAME,
			SUPABASE_BACKUP_SERVICE_NAME,
		])
	})

	it('pins each supabase service to its module image constant', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(parsed.services.db.image).toBe(SUPABASE_POSTGRES_IMAGE)
		expect(parsed.services.auth.image).toBe(SUPABASE_AUTH_IMAGE)
		expect(parsed.services.realtime.image).toBe(SUPABASE_REALTIME_IMAGE)
		expect(parsed.services.storage.image).toBe(SUPABASE_STORAGE_IMAGE)
		expect(parsed.services.kong.image).toBe(SUPABASE_KONG_IMAGE)
		expect(parsed.services.studio.image).toBe(SUPABASE_STUDIO_IMAGE)
	})

	it('mounts the supabase-db-data volume on the db service and declares it at the top level', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(parsed.services.db.volumes).toEqual([
			`${SUPABASE_DB_DATA_VOLUME}:${SUPABASE_DB_DATA_DIR}`,
			buildPostgresExporterInitMount(),
		])
		expect(parsed.volumes).toEqual({ [SUPABASE_DB_DATA_VOLUME]: {} })
	})

	it('bind-mounts the postgres-exporter bootstrap SQL into /docker-entrypoint-initdb.d/ on the db service as read-only', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(parsed.services.db.volumes).toContain(
			`${POSTGRES_EXPORTER_INIT_HOST_PATH}:${POSTGRES_EXPORTER_INIT_MOUNT_PATH}:ro`,
		)
	})

	it('does not mount the postgres-exporter bootstrap SQL when supabase is omitted', () => {
		const result = renderComposeFile(baseInput)
		const parsed = parse(result)

		expect(parsed.services).not.toHaveProperty('db')
	})

	it('declares auth, realtime, storage, and kong as depending on db', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(parsed.services.auth.depends_on).toEqual(['db'])
		expect(parsed.services.realtime.depends_on).toEqual(['db'])
		expect(parsed.services.storage.depends_on).toEqual(['db'])
		expect(parsed.services.kong.depends_on).toEqual(['db'])
	})

	it('omits depends_on on db (root) and studio (talks via kong)', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(parsed.services.db).not.toHaveProperty('depends_on')
		expect(parsed.services.studio).not.toHaveProperty('depends_on')
	})

	it('exposes no host ports on any supabase service - exposure is fronted by the VPS reverse proxy', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		const supabaseServiceNames = [
			'db',
			'auth',
			'realtime',
			'storage',
			'kong',
			'studio',
		] as const
		for (const name of supabaseServiceNames) {
			expect(parsed.services[name]).not.toHaveProperty('ports')
		}
	})

	it('leaves the app service unchanged when services.supabase is declared - no app↔supabase depends_on coupling', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(parsed.services.app).toEqual({
			image: 'ghcr.io/acme/web:sha-abc123',
			restart: 'unless-stopped',
			env_file: ['.env'],
			ports: [`127.0.0.1:8080:${CONTAINER_PORT}`],
		})
	})

	it('produces an unchanged compose YAML when services.supabase is omitted', () => {
		const withoutSupabase = renderComposeFile(baseInput)

		expect(parse(withoutSupabase)).toEqual({
			services: {
				app: {
					image: 'ghcr.io/acme/web:sha-abc123',
					restart: 'unless-stopped',
					env_file: ['.env'],
					ports: [`127.0.0.1:8080:${CONTAINER_PORT}`],
				},
			},
		})
		expect(parse(withoutSupabase).services).not.toHaveProperty('db')
		expect(parse(withoutSupabase).services).not.toHaveProperty('kong')
		expect(parse(withoutSupabase)).not.toHaveProperty('volumes')
	})

	it('merges supabase services with the embedded postgres sidecar when both are declared', () => {
		const result = renderComposeFile({
			...baseInput,
			postgres: {
				mode: 'embedded',
			},
			supabase: {},
		})
		const parsed = parse(result)

		expect(Object.keys(parsed.services)).toEqual([
			'app',
			'postgres',
			'postgres-backup',
			'db',
			'auth',
			'realtime',
			'storage',
			'kong',
			'studio',
			POSTGRES_EXPORTER_SERVICE_NAME,
			SUPABASE_BACKUP_SERVICE_NAME,
		])
		expect(parsed.volumes).toEqual({
			[POSTGRES_DATA_VOLUME]: {},
			[SUPABASE_DB_DATA_VOLUME]: {},
		})
	})
})

describe('renderComposeFile - postgres-exporter sidecar wiring', () => {
	const baseInput = {
		image: IMAGE,
		hostPort: 8080,
		projectName: PROJECT_NAME,
		environment: ENVIRONMENT,
		postgres: undefined,
	} as const

	it('omits the postgres-exporter sidecar when services.supabase is not declared', () => {
		const result = renderComposeFile(baseInput)
		const parsed = parse(result)

		expect(parsed.services).not.toHaveProperty(
			POSTGRES_EXPORTER_SERVICE_NAME,
		)
	})

	it('pins the exporter sidecar to the module image constant', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(parsed.services[POSTGRES_EXPORTER_SERVICE_NAME].image).toBe(
			POSTGRES_EXPORTER_IMAGE,
		)
	})

	it('binds the exporter port to the Tailscale interface via the TAILSCALE_IP env var', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(parsed.services[POSTGRES_EXPORTER_SERVICE_NAME].ports).toEqual([
			`\${${TAILSCALE_IP_ENV}}:${String(POSTGRES_EXPORTER_PORT)}:${String(POSTGRES_EXPORTER_PORT)}`,
		])
	})

	it('passes the DSN through the documented DATA_SOURCE_NAME env channel', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(
			parsed.services[POSTGRES_EXPORTER_SERVICE_NAME].environment[
				POSTGRES_EXPORTER_DSN_ENV
			],
		).toBe(
			buildPostgresExporterDsn(`\${${POSTGRES_EXPORTER_PASSWORD_ENV}}`),
		)
	})

	it('declares the exporter as depending on the supabase db service', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(
			parsed.services[POSTGRES_EXPORTER_SERVICE_NAME].depends_on,
		).toEqual(['db'])
	})

	it('keeps the exporter authenticated as the postgres_exporter role inside the DSN', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		const dsn =
			parsed.services[POSTGRES_EXPORTER_SERVICE_NAME].environment[
				POSTGRES_EXPORTER_DSN_ENV
			]
		expect(dsn).toContain(`${POSTGRES_EXPORTER_USER}:`)
	})
})

describe('renderComposeFile - supabase-backup sidecar wiring', () => {
	const baseInput = {
		image: IMAGE,
		hostPort: 8080,
		projectName: PROJECT_NAME,
		environment: ENVIRONMENT,
		postgres: undefined,
	} as const

	it('omits the supabase-backup sidecar when services.supabase is not declared', () => {
		const result = renderComposeFile(baseInput)
		const parsed = parse(result)

		expect(parsed.services).not.toHaveProperty(SUPABASE_BACKUP_SERVICE_NAME)
	})

	it('pins the backup sidecar to the module image constant', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(parsed.services[SUPABASE_BACKUP_SERVICE_NAME].image).toBe(
			SUPABASE_BACKUP_IMAGE,
		)
	})

	it('declares the backup sidecar as depending on the supabase db service', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(
			parsed.services[SUPABASE_BACKUP_SERVICE_NAME].depends_on,
		).toEqual(['db'])
	})

	it('does not expose the backup sidecar on a host port', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(
			parsed.services[SUPABASE_BACKUP_SERVICE_NAME],
		).not.toHaveProperty('ports')
	})

	it('exposes BACKUP_R2_*, PGPASSWORD, and per-deploy PROJECT/ENV as shell env vars the script reads', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(
			parsed.services[SUPABASE_BACKUP_SERVICE_NAME].environment,
		).toEqual({
			AWS_ACCESS_KEY_ID: '${BACKUP_R2_ACCESS_KEY_ID}',
			AWS_SECRET_ACCESS_KEY: '${BACKUP_R2_SECRET_ACCESS_KEY}',
			AWS_DEFAULT_REGION: 'auto',
			PGPASSWORD: '${POSTGRES_PASSWORD}',
			BUCKET: '${BACKUP_R2_BUCKET}',
			ENDPOINT: '${BACKUP_R2_ENDPOINT}',
			PROJECT: PROJECT_NAME,
			ENV: ENVIRONMENT,
		})
	})

	it('drives the loop with `sh -c <script>` so a single entrypoint owns the schedule', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		const entrypoint =
			parsed.services[SUPABASE_BACKUP_SERVICE_NAME].entrypoint
		expect(entrypoint[0]).toBe('sh')
		expect(entrypoint[1]).toBe('-c')
		expect(typeof entrypoint[2]).toBe('string')
	})

	it('renders the same script regardless of project or environment - per-deploy values flow through env vars', () => {
		const a = renderComposeFile({
			...baseInput,
			projectName: 'a',
			environment: 'development',
			supabase: {},
		})
		const b = renderComposeFile({
			...baseInput,
			projectName: 'b',
			environment: 'production',
			supabase: {},
		})

		const scriptA =
			parse(a).services[SUPABASE_BACKUP_SERVICE_NAME].entrypoint[2]
		const scriptB =
			parse(b).services[SUPABASE_BACKUP_SERVICE_NAME].entrypoint[2]
		expect(scriptA).toBe(scriptB)
	})

	it('emits a key matching the spec pattern pg_dump_<project>_<env>_<ts>.sql.gz from the PROJECT/ENV shell env vars', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		const script =
			parsed.services[SUPABASE_BACKUP_SERVICE_NAME].entrypoint[2]
		expect(script).toContain('key="pg_dump_${PROJECT}_${ENV}_${ts}.sql.gz"')
		expect(script).toContain('date -u +%Y%m%dT%H%M%SZ')
	})

	it('pipes pg_dump through gzip into aws s3 cp against the BACKUP_R2 endpoint', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		const script =
			parsed.services[SUPABASE_BACKUP_SERVICE_NAME].entrypoint[2]
		expect(script).toContain('pg_dump -h db -U postgres -d postgres')
		expect(script).toContain('| gzip |')
		expect(script).toContain(
			'aws s3 cp - "s3://${BUCKET}/${key}" --endpoint-url "${ENDPOINT}"',
		)
	})

	it('sleeps SUPABASE_BACKUP_INTERVAL_SECONDS between iterations (daily cadence)', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		const script =
			parsed.services[SUPABASE_BACKUP_SERVICE_NAME].entrypoint[2]
		expect(SUPABASE_BACKUP_INTERVAL_SECONDS).toBe(86_400)
		expect(script).toContain(
			`sleep ${String(SUPABASE_BACKUP_INTERVAL_SECONDS)}`,
		)
	})

	it('renders the sidecar with restart=unless-stopped so the loop survives single-pass failures', () => {
		const result = renderComposeFile({
			...baseInput,
			supabase: {},
		})
		const parsed = parse(result)

		expect(parsed.services[SUPABASE_BACKUP_SERVICE_NAME].restart).toBe(
			'unless-stopped',
		)
	})
})
