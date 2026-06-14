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

import { renderComposeFile } from './compose-file.ts'

import type { UserServiceConfig } from '#/config/types.ts'
import type { ImageRef } from '#/domain/deploy/target.ts'
import type { ComposeFileInput } from './compose-file.ts'

const IMAGE: ImageRef = {
	registry: 'ghcr.io',
	repository: 'acme/web',
	tag: 'sha-abc123',
}

const PROJECT_NAME = 'acme-web'
const ENVIRONMENT = 'production'

// The primary user workload: a public `build` service on port 3000 with a
// `url`, so it publishes a host port. The compose renderer keys images +
// host ports by the service name.
const APP_SERVICE: UserServiceConfig = {
	port: 3000,
	url: 'example.com',
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'build',
	target: 'app',
}

const APP_HEALTHCHECK = {
	test: ['CMD', 'wget', '-q', '-O-', 'http://localhost:3000/healthz'],
	interval: '10s',
	timeout: '3s',
	retries: 6,
}

function baseInput(
	overrides: Partial<ComposeFileInput> = {},
): ComposeFileInput {
	return {
		services: { app: APP_SERVICE },
		images: { app: IMAGE },
		hostPorts: { app: 8080 },
		projectName: PROJECT_NAME,
		environment: ENVIRONMENT,
		postgres: undefined,
		...overrides,
	}
}

describe('renderComposeFile', () => {
	it('renders the user service with image, per-service env file, healthcheck, and port mapping', () => {
		const parsed = parse(renderComposeFile(baseInput()))

		expect(parsed).toEqual({
			services: {
				app: {
					image: 'ghcr.io/acme/web:sha-abc123',
					restart: 'unless-stopped',
					env_file: ['.env.app'],
					healthcheck: APP_HEALTHCHECK,
					ports: [`127.0.0.1:8080:${APP_SERVICE.port}`],
				},
			},
		})
	})

	it('names the env file after the service instance', () => {
		const parsed = parse(
			renderComposeFile({
				services: { web: APP_SERVICE },
				images: { web: IMAGE },
				hostPorts: { web: 8080 },
				projectName: PROJECT_NAME,
				environment: ENVIRONMENT,
				postgres: undefined,
			}),
		)

		expect(parsed.services.web.env_file).toEqual(['.env.web'])
	})

	it('emits a /healthz healthcheck targeting the service port', () => {
		const parsed = parse(
			renderComposeFile(
				baseInput({
					services: { app: { ...APP_SERVICE, port: 4000 } },
				}),
			),
		)

		expect(parsed.services.app.healthcheck).toEqual({
			test: ['CMD', 'wget', '-q', '-O-', 'http://localhost:4000/healthz'],
			interval: '10s',
			timeout: '3s',
			retries: 6,
		})
	})

	it('omits the healthcheck for an upstream service (image not built by NextNode)', () => {
		const upstream: UserServiceConfig = {
			port: 3000,
			url: 'example.com',
			secrets: [],
			needs: [],
			dependsOn: [],
			source: 'upstream',
			ref: 'docker.io/library/nginx:1.27',
		}
		const parsed = parse(
			renderComposeFile(
				baseInput({
					services: { app: upstream },
					images: {
						app: {
							registry: 'docker.io',
							repository: 'library/nginx',
							tag: '1.27',
						},
					},
				}),
			),
		)

		expect(parsed.services.app).not.toHaveProperty('healthcheck')
		expect(parsed.services.app.image).toBe('docker.io/library/nginx:1.27')
	})

	it('binds to 127.0.0.1 only', () => {
		const parsed = parse(
			renderComposeFile(baseInput({ hostPorts: { app: 8081 } })),
		)

		expect(parsed.services.app.ports[0]).toMatch(/^127\.0\.0\.1:8081:/)
	})

	it('maps the allocated host port to the service container port', () => {
		const parsed = parse(
			renderComposeFile(baseInput({ hostPorts: { app: 8080 } })),
		)

		expect(parsed.services.app.ports[0]).toBe(
			`127.0.0.1:8080:${APP_SERVICE.port}`,
		)
	})

	it('omits the port mapping for a service without a url', () => {
		const internal: UserServiceConfig = {
			port: 3000,
			secrets: [],
			needs: [],
			dependsOn: [],
			source: 'build',
			target: 'worker',
		}
		const parsed = parse(
			renderComposeFile({
				services: { worker: internal },
				images: { worker: IMAGE },
				hostPorts: {},
				projectName: PROJECT_NAME,
				environment: ENVIRONMENT,
				postgres: undefined,
			}),
		)

		expect(parsed.services.worker).not.toHaveProperty('ports')
		expect(parsed.services.worker.healthcheck).toEqual(APP_HEALTHCHECK)
	})

	it('uses the resolved image ref in the image field', () => {
		const parsed = parse(
			renderComposeFile(
				baseInput({
					images: {
						app: {
							registry: 'registry.example.com',
							repository: 'team/app',
							tag: 'v2.0.0',
						},
					},
				}),
			),
		)

		expect(parsed.services.app.image).toBe(
			'registry.example.com/team/app:v2.0.0',
		)
	})

	it('throws when a service has no resolved image ref', () => {
		expect(() =>
			renderComposeFile({
				services: { app: APP_SERVICE },
				images: {},
				hostPorts: { app: 8080 },
				projectName: PROJECT_NAME,
				environment: ENVIRONMENT,
				postgres: undefined,
			}),
		).toThrow('missing image ref for service "app"')
	})

	it('throws when a url service has no allocated host port', () => {
		expect(() =>
			renderComposeFile({
				services: { app: APP_SERVICE },
				images: { app: IMAGE },
				hostPorts: {},
				projectName: PROJECT_NAME,
				environment: ENVIRONMENT,
				postgres: undefined,
			}),
		).toThrow('service "app" declares a url but has no allocated host port')
	})

	it('omits volumes keys when no volumes are provided', () => {
		const parsed = parse(renderComposeFile(baseInput()))

		expect(parsed.services.app).not.toHaveProperty('volumes')
		expect(parsed).not.toHaveProperty('volumes')
	})

	it('omits volumes keys when an empty volumes array is provided', () => {
		const parsed = parse(renderComposeFile(baseInput({ volumes: [] })))

		expect(parsed.services.app).not.toHaveProperty('volumes')
		expect(parsed).not.toHaveProperty('volumes')
	})

	it('renders the same YAML with no volumes as without the field', () => {
		const without = renderComposeFile(baseInput())
		const withEmpty = renderComposeFile(baseInput({ volumes: [] }))

		expect(withEmpty).toBe(without)
	})

	it('emits service.volumes mounts and a top-level named volume when provided', () => {
		const parsed = parse(
			renderComposeFile(
				baseInput({
					volumes: [{ name: 'data', mount: '/var/lib/app' }],
				}),
			),
		)

		expect(parsed.services.app.volumes).toEqual(['data:/var/lib/app'])
		expect(parsed.volumes).toEqual({ data: {} })
	})

	it('emits multiple volumes preserving order', () => {
		const parsed = parse(
			renderComposeFile(
				baseInput({
					volumes: [
						{ name: 'data', mount: '/var/lib/app' },
						{ name: 'cache', mount: '/var/cache/app' },
					],
				}),
			),
		)

		expect(parsed.services.app.volumes).toEqual([
			'data:/var/lib/app',
			'cache:/var/cache/app',
		])
		expect(parsed.volumes).toEqual({ data: {}, cache: {} })
	})

	it('keeps image, restart, env_file, healthcheck, and ports unchanged when volumes are added', () => {
		const parsed = parse(
			renderComposeFile(
				baseInput({
					volumes: [{ name: 'data', mount: '/var/lib/app' }],
				}),
			),
		)

		expect(parsed.services.app.image).toBe('ghcr.io/acme/web:sha-abc123')
		expect(parsed.services.app.restart).toBe('unless-stopped')
		expect(parsed.services.app.env_file).toEqual(['.env.app'])
		expect(parsed.services.app.healthcheck).toEqual(APP_HEALTHCHECK)
		expect(parsed.services.app.ports).toEqual([
			`127.0.0.1:8080:${APP_SERVICE.port}`,
		])
	})

	it('emits a wal-g postgres sidecar with archiving enabled in production', () => {
		const parsed = parse(
			renderComposeFile(baseInput({ postgres: { mode: 'embedded' } })),
		)

		expect(parsed.services.postgres).toEqual({
			image: 'nextnode-postgres-walg:18',
			build: { context: './postgres-walg' },
			restart: 'unless-stopped',
			env_file: ['.env'],
			volumes: [
				`${POSTGRES_DATA_VOLUME}:${POSTGRES_DATA_DIR}`,
				'./00-pg-monitor.sql:/docker-entrypoint-initdb.d/00-pg-monitor.sql:ro',
			],
			healthcheck: {
				test: ['CMD-SHELL', 'pg_isready -U acme_web -d acme_web'],
				interval: '10s',
				timeout: '5s',
				retries: 5,
			},
			command: [
				'postgres',
				'-c',
				'wal_level=replica',
				'-c',
				'archive_mode=on',
				'-c',
				'archive_command=wal-g wal-push %p',
				'-c',
				'archive_timeout=180',
				'-c',
				'restore_command=wal-g wal-fetch %f %p',
			],
			environment: {
				WALG_S3_PREFIX: 's3://nn-walg-acme-web',
				AWS_ACCESS_KEY_ID: '${POSTGRES_BACKUP_R2_ACCESS_KEY_ID}',
				AWS_SECRET_ACCESS_KEY:
					'${POSTGRES_BACKUP_R2_SECRET_ACCESS_KEY}',
				AWS_ENDPOINT: '${POSTGRES_BACKUP_R2_ENDPOINT}',
				AWS_REGION: 'auto',
				AWS_S3_FORCE_PATH_STYLE: 'true',
				WALG_COMPRESSION_METHOD: 'lz4',
			},
		})
		expect(parsed.volumes).toEqual({ [POSTGRES_DATA_VOLUME]: {} })
	})

	it('runs the postgres sidecar with no archiving in development', () => {
		const parsed = parse(
			renderComposeFile(
				baseInput({
					environment: 'development',
					postgres: { mode: 'embedded' },
				}),
			),
		)

		expect(parsed.services.postgres.image).toBe('nextnode-postgres-walg:18')
		expect(parsed.services.postgres.build).toEqual({
			context: './postgres-walg',
		})
		expect(parsed.services.postgres).not.toHaveProperty('command')
		expect(parsed.services.postgres).not.toHaveProperty('environment')
		// Zero backups in dev: no wal-g loop sidecar.
		expect(parsed.services).not.toHaveProperty('postgres-walg')
	})

	it('does not expose postgres on a host port', () => {
		const parsed = parse(
			renderComposeFile(baseInput({ postgres: { mode: 'embedded' } })),
		)

		expect(parsed.services.postgres).not.toHaveProperty('ports')
	})

	it('omits the postgres sidecar when mode is external', () => {
		const parsed = parse(
			renderComposeFile(baseInput({ postgres: { mode: 'external' } })),
		)

		expect(parsed.services).not.toHaveProperty('postgres')
		expect(parsed.services).not.toHaveProperty('postgres-walg')
		expect(parsed).not.toHaveProperty('volumes')
	})

	it('emits a wal-g base-backup loop sidecar when postgres is embedded in production', () => {
		const parsed = parse(
			renderComposeFile(baseInput({ postgres: { mode: 'embedded' } })),
		)

		expect(parsed.services['postgres-walg']).toEqual({
			image: 'nextnode-postgres-walg:18',
			build: { context: './postgres-walg' },
			restart: 'unless-stopped',
			depends_on: ['postgres'],
			command: ['walg-backup-loop.sh'],
			volumes: [`${POSTGRES_DATA_VOLUME}:${POSTGRES_DATA_DIR}:ro`],
			environment: {
				WALG_S3_PREFIX: 's3://nn-walg-acme-web',
				AWS_ACCESS_KEY_ID: '${POSTGRES_BACKUP_R2_ACCESS_KEY_ID}',
				AWS_SECRET_ACCESS_KEY:
					'${POSTGRES_BACKUP_R2_SECRET_ACCESS_KEY}',
				AWS_ENDPOINT: '${POSTGRES_BACKUP_R2_ENDPOINT}',
				AWS_REGION: 'auto',
				AWS_S3_FORCE_PATH_STYLE: 'true',
				WALG_COMPRESSION_METHOD: 'lz4',
				PGDATA: '/var/lib/postgresql/18/docker',
				WALG_BACKUP_INTERVAL: '86400',
				WALG_RETAIN_COUNT: '7',
				PGHOST: 'postgres',
				PGPORT: '5432',
				PGUSER: 'acme_web',
				PGDATABASE: 'acme_web',
				PGPASSWORD: '${POSTGRES_PASSWORD}',
			},
		})
	})

	it('does not expose the wal-g backup loop on a host port', () => {
		const parsed = parse(
			renderComposeFile(baseInput({ postgres: { mode: 'embedded' } })),
		)

		expect(parsed.services['postgres-walg']).not.toHaveProperty('ports')
	})

	it('merges the postgres-data volume with user-declared volumes', () => {
		const parsed = parse(
			renderComposeFile(
				baseInput({
					volumes: [{ name: 'app-data', mount: '/var/lib/app' }],
					postgres: { mode: 'embedded' },
				}),
			),
		)

		expect(parsed.volumes).toEqual({
			'app-data': {},
			[POSTGRES_DATA_VOLUME]: {},
		})
	})
})

describe('renderComposeFile - multiple user services', () => {
	const API_IMAGE: ImageRef = {
		registry: 'ghcr.io',
		repository: 'acme/web-api',
		tag: 'sha-abc123',
	}
	const API_SERVICE: UserServiceConfig = {
		port: 3001,
		secrets: [],
		needs: [],
		dependsOn: [],
		source: 'build',
		target: 'api',
	}

	it('renders each declared service with its own image, env file, and healthcheck', () => {
		const parsed = parse(
			renderComposeFile({
				services: { app: APP_SERVICE, api: API_SERVICE },
				images: { app: IMAGE, api: API_IMAGE },
				hostPorts: { app: 8080 },
				projectName: PROJECT_NAME,
				environment: ENVIRONMENT,
				postgres: undefined,
			}),
		)

		expect(Object.keys(parsed.services)).toEqual(['app', 'api'])
		expect(parsed.services.app.image).toBe('ghcr.io/acme/web:sha-abc123')
		expect(parsed.services.app.env_file).toEqual(['.env.app'])
		expect(parsed.services.api.image).toBe(
			'ghcr.io/acme/web-api:sha-abc123',
		)
		expect(parsed.services.api.env_file).toEqual(['.env.api'])
		expect(parsed.services.api.healthcheck).toEqual({
			test: ['CMD', 'wget', '-q', '-O-', 'http://localhost:3001/healthz'],
			interval: '10s',
			timeout: '3s',
			retries: 6,
		})
	})

	it('publishes a host port only for the url-bearing service', () => {
		const parsed = parse(
			renderComposeFile({
				services: { app: APP_SERVICE, api: API_SERVICE },
				images: { app: IMAGE, api: API_IMAGE },
				hostPorts: { app: 8080 },
				projectName: PROJECT_NAME,
				environment: ENVIRONMENT,
				postgres: undefined,
			}),
		)

		expect(parsed.services.app.ports).toEqual([
			`127.0.0.1:8080:${APP_SERVICE.port}`,
		])
		expect(parsed.services.api).not.toHaveProperty('ports')
	})

	it('gates a service on each sibling it lists in depends_on', () => {
		const parsed = parse(
			renderComposeFile({
				services: {
					app: { ...APP_SERVICE, dependsOn: ['api'] },
					api: API_SERVICE,
				},
				images: { app: IMAGE, api: API_IMAGE },
				hostPorts: { app: 8080 },
				projectName: PROJECT_NAME,
				environment: ENVIRONMENT,
				postgres: undefined,
			}),
		)

		expect(parsed.services.app.depends_on).toEqual({
			api: { condition: 'service_healthy' },
		})
		expect(parsed.services.api).not.toHaveProperty('depends_on')
	})

	it('gates on service_started for an upstream sibling that has no healthcheck', () => {
		const gateway: UserServiceConfig = {
			port: 3002,
			secrets: [],
			needs: [],
			dependsOn: [],
			source: 'upstream',
			ref: 'docker.io/acme/gateway:1.0',
		}
		const parsed = parse(
			renderComposeFile({
				services: {
					web: {
						port: 3000,
						secrets: [],
						needs: [],
						dependsOn: ['gateway'],
						source: 'upstream',
						ref: 'docker.io/acme/web:1.0',
					},
					gateway,
				},
				images: {
					web: {
						registry: 'docker.io',
						repository: 'acme/web',
						tag: '1.0',
					},
					gateway: {
						registry: 'docker.io',
						repository: 'acme/gateway',
						tag: '1.0',
					},
				},
				hostPorts: {},
				projectName: PROJECT_NAME,
				environment: ENVIRONMENT,
				postgres: undefined,
			}),
		)

		expect(parsed.services.web.depends_on).toEqual({
			gateway: { condition: 'service_started' },
		})
		expect(parsed.services.gateway).not.toHaveProperty('healthcheck')
	})

	it('gates a non-primary service on its declared sibling', () => {
		const parsed = parse(
			renderComposeFile({
				services: {
					app: APP_SERVICE,
					api: { ...API_SERVICE, dependsOn: ['app'] },
				},
				images: { app: IMAGE, api: API_IMAGE },
				hostPorts: { app: 8080 },
				projectName: PROJECT_NAME,
				environment: ENVIRONMENT,
				postgres: undefined,
			}),
		)

		expect(parsed.services.api.depends_on).toEqual({
			app: { condition: 'service_healthy' },
		})
		expect(parsed.services.app).not.toHaveProperty('depends_on')
	})

	it('merges inter-service depends_on with the embedded-postgres dependency on the primary', () => {
		const parsed = parse(
			renderComposeFile({
				services: {
					app: { ...APP_SERVICE, dependsOn: ['api'] },
					api: API_SERVICE,
				},
				images: { app: IMAGE, api: API_IMAGE },
				hostPorts: { app: 8080 },
				projectName: PROJECT_NAME,
				environment: ENVIRONMENT,
				postgres: { mode: 'embedded' },
			}),
		)

		expect(parsed.services.app.depends_on).toEqual({
			api: { condition: 'service_healthy' },
			postgres: { condition: 'service_healthy' },
		})
	})

	it('attaches user volumes and the postgres dependency to the first declared service only', () => {
		const parsed = parse(
			renderComposeFile({
				services: { app: APP_SERVICE, api: API_SERVICE },
				images: { app: IMAGE, api: API_IMAGE },
				hostPorts: { app: 8080 },
				volumes: [{ name: 'data', mount: '/var/lib/app' }],
				projectName: PROJECT_NAME,
				environment: ENVIRONMENT,
				postgres: { mode: 'embedded' },
			}),
		)

		expect(parsed.services.app.volumes).toEqual(['data:/var/lib/app'])
		expect(parsed.services.app.depends_on).toEqual({
			postgres: { condition: 'service_healthy' },
		})
		expect(parsed.services.api).not.toHaveProperty('volumes')
		expect(parsed.services.api).not.toHaveProperty('depends_on')
	})
})

describe('renderComposeFile - postgres service wiring', () => {
	it('renders the postgres server, wal-g backup loop, and exporter in embedded mode', () => {
		const parsed = parse(
			renderComposeFile(baseInput({ postgres: { mode: 'embedded' } })),
		)

		expect(Object.keys(parsed.services)).toEqual([
			'app',
			'postgres',
			'postgres-walg',
			'postgres-exporter',
		])
		expect(parsed.volumes).toEqual({ [POSTGRES_DATA_VOLUME]: {} })
	})

	it('renders no postgres-related services or volumes when postgres config is undefined', () => {
		const parsed = parse(
			renderComposeFile(baseInput({ postgres: undefined })),
		)

		expect(Object.keys(parsed.services)).toEqual(['app'])
		expect(parsed).not.toHaveProperty('volumes')
	})

	it('renders no postgres sidecars when postgres mode is external', () => {
		const parsed = parse(
			renderComposeFile(baseInput({ postgres: { mode: 'external' } })),
		)

		expect(Object.keys(parsed.services)).toEqual(['app'])
		expect(parsed).not.toHaveProperty('volumes')
	})

	it('declares app depends_on postgres service_healthy when postgres is embedded', () => {
		const parsed = parse(
			renderComposeFile(baseInput({ postgres: { mode: 'embedded' } })),
		)

		expect(parsed.services.app.depends_on).toEqual({
			postgres: { condition: 'service_healthy' },
		})
	})

	it('omits app depends_on when postgres mode is external', () => {
		const parsed = parse(
			renderComposeFile(baseInput({ postgres: { mode: 'external' } })),
		)

		expect(parsed.services.app).not.toHaveProperty('depends_on')
	})
})

describe('renderComposeFile - supabase service wiring', () => {
	it('renders the full self-host stack (db + auth + realtime + storage + kong + studio) plus the postgres-exporter and supabase-backup sidecars when services.supabase is declared', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

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
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(parsed.services.db.image).toBe(SUPABASE_POSTGRES_IMAGE)
		expect(parsed.services.auth.image).toBe(SUPABASE_AUTH_IMAGE)
		expect(parsed.services.realtime.image).toBe(SUPABASE_REALTIME_IMAGE)
		expect(parsed.services.storage.image).toBe(SUPABASE_STORAGE_IMAGE)
		expect(parsed.services.kong.image).toBe(SUPABASE_KONG_IMAGE)
		expect(parsed.services.studio.image).toBe(SUPABASE_STUDIO_IMAGE)
	})

	it('mounts the supabase-db-data volume on the db service and declares it at the top level', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(parsed.services.db.volumes).toEqual([
			`${SUPABASE_DB_DATA_VOLUME}:${SUPABASE_DB_DATA_DIR}`,
			buildPostgresExporterInitMount(),
		])
		expect(parsed.volumes).toEqual({ [SUPABASE_DB_DATA_VOLUME]: {} })
	})

	it('bind-mounts the postgres-exporter bootstrap SQL into /docker-entrypoint-initdb.d/ on the db service as read-only', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(parsed.services.db.volumes).toContain(
			`${POSTGRES_EXPORTER_INIT_HOST_PATH}:${POSTGRES_EXPORTER_INIT_MOUNT_PATH}:ro`,
		)
	})

	it('does not mount the postgres-exporter bootstrap SQL when supabase is omitted', () => {
		const parsed = parse(renderComposeFile(baseInput()))

		expect(parsed.services).not.toHaveProperty('db')
	})

	it('declares auth, realtime, storage, and kong as depending on db', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(parsed.services.auth.depends_on).toEqual(['db'])
		expect(parsed.services.realtime.depends_on).toEqual(['db'])
		expect(parsed.services.storage.depends_on).toEqual(['db'])
		expect(parsed.services.kong.depends_on).toEqual(['db'])
	})

	it('omits depends_on on db (root) and studio (talks via kong)', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(parsed.services.db).not.toHaveProperty('depends_on')
		expect(parsed.services.studio).not.toHaveProperty('depends_on')
	})

	it('exposes no host ports on any supabase service - exposure is fronted by the VPS reverse proxy', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

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
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(parsed.services.app).toEqual({
			image: 'ghcr.io/acme/web:sha-abc123',
			restart: 'unless-stopped',
			env_file: ['.env.app'],
			healthcheck: APP_HEALTHCHECK,
			ports: [`127.0.0.1:8080:${APP_SERVICE.port}`],
		})
	})

	it('produces an unchanged compose YAML when services.supabase is omitted', () => {
		const withoutSupabase = renderComposeFile(baseInput())

		expect(parse(withoutSupabase)).toEqual({
			services: {
				app: {
					image: 'ghcr.io/acme/web:sha-abc123',
					restart: 'unless-stopped',
					env_file: ['.env.app'],
					healthcheck: APP_HEALTHCHECK,
					ports: [`127.0.0.1:8080:${APP_SERVICE.port}`],
				},
			},
		})
		expect(parse(withoutSupabase).services).not.toHaveProperty('db')
		expect(parse(withoutSupabase).services).not.toHaveProperty('kong')
		expect(parse(withoutSupabase)).not.toHaveProperty('volumes')
	})

	it('merges supabase services with the embedded postgres sidecar when both are declared', () => {
		const parsed = parse(
			renderComposeFile(
				baseInput({ postgres: { mode: 'embedded' }, supabase: {} }),
			),
		)

		expect(Object.keys(parsed.services)).toEqual([
			'app',
			'postgres',
			'postgres-walg',
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
	it('omits the postgres-exporter sidecar when services.supabase is not declared', () => {
		const parsed = parse(renderComposeFile(baseInput()))

		expect(parsed.services).not.toHaveProperty(
			POSTGRES_EXPORTER_SERVICE_NAME,
		)
	})

	it('pins the exporter sidecar to the module image constant', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(parsed.services[POSTGRES_EXPORTER_SERVICE_NAME].image).toBe(
			POSTGRES_EXPORTER_IMAGE,
		)
	})

	it('binds the exporter port to the Tailscale interface via the TAILSCALE_IP env var', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(parsed.services[POSTGRES_EXPORTER_SERVICE_NAME].ports).toEqual([
			`\${${TAILSCALE_IP_ENV}}:${String(POSTGRES_EXPORTER_PORT)}:${String(POSTGRES_EXPORTER_PORT)}`,
		])
	})

	it('passes the DSN through the documented DATA_SOURCE_NAME env channel', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(
			parsed.services[POSTGRES_EXPORTER_SERVICE_NAME].environment[
				POSTGRES_EXPORTER_DSN_ENV
			],
		).toBe(
			buildPostgresExporterDsn(`\${${POSTGRES_EXPORTER_PASSWORD_ENV}}`),
		)
	})

	it('declares the exporter as depending on the supabase db service', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(
			parsed.services[POSTGRES_EXPORTER_SERVICE_NAME].depends_on,
		).toEqual(['db'])
	})

	it('keeps the exporter authenticated as the postgres_exporter role inside the DSN', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		const dsn =
			parsed.services[POSTGRES_EXPORTER_SERVICE_NAME].environment[
				POSTGRES_EXPORTER_DSN_ENV
			]
		expect(dsn).toContain(`${POSTGRES_EXPORTER_USER}:`)
	})
})

describe('renderComposeFile - supabase-backup sidecar wiring', () => {
	it('omits the supabase-backup sidecar when services.supabase is not declared', () => {
		const parsed = parse(renderComposeFile(baseInput()))

		expect(parsed.services).not.toHaveProperty(SUPABASE_BACKUP_SERVICE_NAME)
	})

	it('pins the backup sidecar to the module image constant', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(parsed.services[SUPABASE_BACKUP_SERVICE_NAME].image).toBe(
			SUPABASE_BACKUP_IMAGE,
		)
	})

	it('declares the backup sidecar as depending on the supabase db service', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(
			parsed.services[SUPABASE_BACKUP_SERVICE_NAME].depends_on,
		).toEqual(['db'])
	})

	it('does not expose the backup sidecar on a host port', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(
			parsed.services[SUPABASE_BACKUP_SERVICE_NAME],
		).not.toHaveProperty('ports')
	})

	it('exposes BACKUP_R2_*, PGPASSWORD, and per-deploy PROJECT/ENV as shell env vars the script reads', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

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
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		const { entrypoint } = parsed.services[SUPABASE_BACKUP_SERVICE_NAME]
		expect(entrypoint[0]).toBe('sh')
		expect(entrypoint[1]).toBe('-c')
		expect(typeof entrypoint[2]).toBe('string')
	})

	it('renders the same script regardless of project or environment - per-deploy values flow through env vars', () => {
		const a = renderComposeFile(
			baseInput({
				projectName: 'a',
				environment: 'development',
				supabase: {},
			}),
		)
		const b = renderComposeFile(
			baseInput({
				projectName: 'b',
				environment: 'production',
				supabase: {},
			}),
		)

		const [, , scriptA] =
			parse(a).services[SUPABASE_BACKUP_SERVICE_NAME].entrypoint
		const [, , scriptB] =
			parse(b).services[SUPABASE_BACKUP_SERVICE_NAME].entrypoint
		expect(scriptA).toBe(scriptB)
	})

	it('emits a key matching the spec pattern pg_dump_<project>_<env>_<ts>.sql.gz from the PROJECT/ENV shell env vars', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		const [, , script] =
			parsed.services[SUPABASE_BACKUP_SERVICE_NAME].entrypoint
		expect(script).toContain('key="pg_dump_${PROJECT}_${ENV}_${ts}.sql.gz"')
		expect(script).toContain('date -u +%Y%m%dT%H%M%SZ')
	})

	it('pipes pg_dump through gzip into aws s3 cp against the BACKUP_R2 endpoint', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		const [, , script] =
			parsed.services[SUPABASE_BACKUP_SERVICE_NAME].entrypoint
		expect(script).toContain('pg_dump -h db -U postgres -d postgres')
		expect(script).toContain('| gzip |')
		expect(script).toContain(
			'aws s3 cp - "s3://${BUCKET}/${key}" --endpoint-url "${ENDPOINT}"',
		)
	})

	it('sleeps SUPABASE_BACKUP_INTERVAL_SECONDS between iterations (daily cadence)', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		const [, , script] =
			parsed.services[SUPABASE_BACKUP_SERVICE_NAME].entrypoint
		expect(SUPABASE_BACKUP_INTERVAL_SECONDS).toBe(86_400)
		expect(script).toContain(
			`sleep ${String(SUPABASE_BACKUP_INTERVAL_SECONDS)}`,
		)
	})

	it('renders the sidecar with restart=unless-stopped so the loop survives single-pass failures', () => {
		const parsed = parse(renderComposeFile(baseInput({ supabase: {} })))

		expect(parsed.services[SUPABASE_BACKUP_SERVICE_NAME].restart).toBe(
			'unless-stopped',
		)
	})
})
