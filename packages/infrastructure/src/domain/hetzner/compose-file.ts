import {
	POSTGRES_EXPORTER_SERVICE_NAME,
	buildPostgresExporterInitMount,
	buildPostgresExporterSidecar,
} from '#/domain/services/postgres-exporter.ts'
import {
	POSTGRES_BACKUP_SERVICE_NAME,
	POSTGRES_DATA_VOLUME,
	POSTGRES_SIDECAR_SERVICE_NAME,
	buildPostgresBackupSidecar,
	buildPostgresSidecar,
} from '#/domain/services/postgres.ts'
import {
	SUPABASE_BACKUP_SERVICE_NAME,
	SUPABASE_DB_DATA_VOLUME,
	SUPABASE_DB_SERVICE_NAME,
	buildSupabaseBackupSidecar,
	buildSupabaseStack,
} from '#/domain/services/supabase.ts'
import { stringify } from 'yaml'

import type {
	PostgresServiceConfig,
	SupabaseServiceConfig,
	UserServiceConfig,
} from '#/config/types.ts'
import type { ImageRef } from '#/domain/deploy/target.ts'
import type { PostgresExporterSidecarService } from '#/domain/services/postgres-exporter.ts'
import type {
	PostgresBackupSidecarService,
	PostgresSidecarService,
} from '#/domain/services/postgres.ts'
import type {
	SupabaseBackupSidecarService,
	SupabaseService,
	SupabaseStack,
} from '#/domain/services/supabase.ts'

/**
 * A Docker named volume managed by the Docker daemon on the VPS local SSD
 * (under `/var/lib/docker/volumes/...`). NOT a Hetzner Block Volume —
 * Hetzner Volumes are not used by default (see `docs/infra-topology.md`).
 */
export interface ComposeVolume {
	readonly name: string
	readonly mount: string
}

export interface ComposeFileInput {
	// User workloads declared under [deploy.services.<name>], by instance name.
	readonly services: Readonly<Record<string, UserServiceConfig>>
	// Resolved image ref per service (build → computed, upstream → parsed).
	readonly images: Readonly<Record<string, ImageRef>>
	// Allocated host port per service — consulted only for `url` services.
	readonly hostPorts: Readonly<Record<string, number>>
	readonly volumes?: ReadonlyArray<ComposeVolume>
	readonly postgres: PostgresServiceConfig | undefined
	readonly supabase?: SupabaseServiceConfig
	readonly projectName: string
	readonly environment: string
}

export function formatImageRef(image: ImageRef): string {
	return `${image.registry}/${image.repository}:${image.tag}`
}

interface ComposeServiceDependency {
	readonly condition: 'service_healthy'
}

interface ComposeHealthcheck {
	readonly test: ReadonlyArray<string>
	readonly interval: string
	readonly timeout: string
	readonly retries: number
}

interface ComposeService {
	readonly image: string
	readonly restart: string
	readonly env_file: ReadonlyArray<string>
	readonly healthcheck?: ComposeHealthcheck
	readonly ports?: ReadonlyArray<string>
	readonly volumes?: ReadonlyArray<string>
	readonly depends_on?: Readonly<Record<string, ComposeServiceDependency>>
}

// /healthz contract (D7): a `build` service answers a liveness probe so compose
// owns bring-up readiness. `wget` and the `/healthz` route are guaranteed by
// the alpine/distroless-busybox bases NextNode builds its app images on. The
// probe is deliberately NOT applied to `upstream` images: they are pulled
// verbatim, so we can't assume they ship `wget` or answer `/healthz` — forcing
// it would flag a healthy container `unhealthy` (and, once depends_on health
// gating lands in M2, block its dependents). Upstream liveness stays the
// image's own contract until a per-service healthcheck override exists.
const HEALTHCHECK_INTERVAL = '10s'
const HEALTHCHECK_TIMEOUT = '3s'
const HEALTHCHECK_RETRIES = 6

function buildHealthcheck(port: number): ComposeHealthcheck {
	return {
		test: ['CMD', 'wget', '-q', '-O-', `http://localhost:${port}/healthz`],
		interval: HEALTHCHECK_INTERVAL,
		timeout: HEALTHCHECK_TIMEOUT,
		retries: HEALTHCHECK_RETRIES,
	}
}

type ComposeServiceLike =
	| ComposeService
	| PostgresSidecarService
	| PostgresBackupSidecarService
	| SupabaseService
	| SupabaseBackupSidecarService
	| PostgresExporterSidecarService

interface ComposeConfig {
	readonly services: Readonly<Record<string, ComposeServiceLike>>
	readonly volumes?: Readonly<Record<string, Record<string, never>>>
}

/**
 * Append the postgres-exporter bootstrap-SQL bind mount to the supabase
 * `db` service's volumes. The mount is what makes the supabase/postgres
 * image run `00-pg-monitor.sql` exactly once on initdb, creating the
 * `postgres_exporter` role the exporter sidecar authenticates as.
 */
function withPostgresExporterInitMount(stack: SupabaseStack): SupabaseStack {
	const db = stack[SUPABASE_DB_SERVICE_NAME]
	if (!db) return stack
	const augmented: SupabaseService = {
		...db,
		volumes: [...(db.volumes ?? []), buildPostgresExporterInitMount()],
	}
	return { ...stack, [SUPABASE_DB_SERVICE_NAME]: augmented }
}

function buildTopLevelVolumes(
	userVolumes: ReadonlyArray<ComposeVolume> = [],
	includePostgres: boolean,
	includeSupabase: boolean,
): Record<string, Record<string, never>> | undefined {
	const result: Record<string, Record<string, never>> = {}
	for (const v of userVolumes) result[v.name] = {}
	if (includePostgres) result[POSTGRES_DATA_VOLUME] = {}
	if (includeSupabase) result[SUPABASE_DB_DATA_VOLUME] = {}
	return Object.keys(result).length ? result : undefined
}

/**
 * Build the postgres group (sidecar + backup) for the compose file.
 * Returns `null` when `mode = external` — the build helpers also gate on
 * mode, so this central check keeps the caller free of the per-sidecar
 * null fan-out and lets the spread into `services` stay one-liner clean.
 */
function buildPostgresServiceGroup(
	config: PostgresServiceConfig,
	projectName: string,
): Readonly<Record<string, ComposeServiceLike>> | null {
	const sidecar = buildPostgresSidecar(config, projectName)
	const backup = buildPostgresBackupSidecar(config, projectName)
	if (sidecar === null || backup === null) return null
	return {
		[POSTGRES_SIDECAR_SERVICE_NAME]: sidecar,
		[POSTGRES_BACKUP_SERVICE_NAME]: backup,
	}
}

/**
 * Build the supabase group (six-service stack + postgres-exporter +
 * backup sidecar) for the compose file. Always non-null when called —
 * `[services.supabase]` has no mode switch like postgres does.
 */
function buildSupabaseServiceGroup(
	projectName: string,
	environment: string,
): Readonly<Record<string, ComposeServiceLike>> {
	return {
		...withPostgresExporterInitMount(buildSupabaseStack()),
		[POSTGRES_EXPORTER_SERVICE_NAME]: buildPostgresExporterSidecar(),
		[SUPABASE_BACKUP_SERVICE_NAME]: buildSupabaseBackupSidecar(
			projectName,
			environment,
		),
	}
}

function buildPortMapping(
	service: UserServiceConfig,
	hostPort: number | undefined,
	name: string,
): { ports?: ReadonlyArray<string> } {
	// Only `url` services face the reverse proxy, so only they publish a host
	// port; internal services are reached by siblings over the compose network.
	if (service.url === undefined) return {}
	if (hostPort === undefined) {
		throw new Error(
			`renderComposeFile: service "${name}" declares a url but has no allocated host port`,
		)
	}
	return {
		ports: [`127.0.0.1:${hostPort}:${service.port}`],
	}
}

// Translate a service's startup ordering into compose `depends_on` gates (D7):
// every sibling listed in `dependsOn` must reach `service_healthy` before this
// service starts, and the primary additionally waits on the embedded postgres
// sidecar. Returns an empty object when the service has no dependencies, so the
// `depends_on` key is omitted from the rendered block entirely.
function buildDependsOn(
	service: UserServiceConfig,
	isPrimary: boolean,
	dependsOnPostgres: boolean,
): { depends_on?: Readonly<Record<string, ComposeServiceDependency>> } {
	const dependencies: Record<string, ComposeServiceDependency> = {}
	for (const sibling of service.dependsOn) {
		dependencies[sibling] = { condition: 'service_healthy' }
	}
	if (isPrimary && dependsOnPostgres) {
		dependencies[POSTGRES_SIDECAR_SERVICE_NAME] = {
			condition: 'service_healthy',
		}
	}
	if (Object.keys(dependencies).length === 0) return {}
	return { depends_on: dependencies }
}

/**
 * Render the user workloads declared under [deploy.services.<name>]. Each
 * gets its own image, per-service env file (`.env.<name>` — the isolation
 * unit, D5) and, for `build` services, a /healthz healthcheck (D7); `upstream`
 * images get no forced probe. Every service gates on the siblings it lists in
 * `dependsOn` (D7); the FIRST declared service is the primary app, which also
 * carries the user-declared volumes and the embedded-postgres `service_healthy`
 * dependency.
 */
function buildUserServices(
	services: Readonly<Record<string, UserServiceConfig>>,
	images: Readonly<Record<string, ImageRef>>,
	hostPorts: Readonly<Record<string, number>>,
	userVolumes: ReadonlyArray<ComposeVolume> | undefined,
	dependsOnPostgres: boolean,
): Record<string, ComposeService> {
	const result: Record<string, ComposeService> = {}
	Object.entries(services).forEach(([name, service], index) => {
		const image = images[name]
		if (!image) {
			throw new Error(
				`renderComposeFile: missing image ref for service "${name}"`,
			)
		}
		const isPrimary = index === 0
		result[name] = {
			image: formatImageRef(image),
			restart: 'unless-stopped',
			env_file: [`.env.${name}`],
			// Only `build` images carry the /healthz + wget contract; upstream
			// images are pulled verbatim and get no forced probe (see the
			// HEALTHCHECK_* block above).
			...(service.source === 'build' && {
				healthcheck: buildHealthcheck(service.port),
			}),
			...buildPortMapping(service, hostPorts[name], name),
			...(isPrimary &&
				userVolumes && {
					volumes: userVolumes.map(v => `${v.name}:${v.mount}`),
				}),
			...buildDependsOn(service, isPrimary, dependsOnPostgres),
		}
	})
	return result
}

export function renderComposeFile(input: ComposeFileInput): string {
	const userVolumes = input.volumes?.length ? input.volumes : undefined
	const postgres = input.postgres
		? buildPostgresServiceGroup(input.postgres, input.projectName)
		: null
	const supabase = input.supabase
		? buildSupabaseServiceGroup(input.projectName, input.environment)
		: null
	const topLevelVolumes = buildTopLevelVolumes(
		userVolumes,
		postgres !== null,
		supabase !== null,
	)

	const config: ComposeConfig = {
		services: {
			...buildUserServices(
				input.services,
				input.images,
				input.hostPorts,
				userVolumes,
				postgres !== null,
			),
			...postgres,
			...supabase,
		},
		...(topLevelVolumes && { volumes: topLevelVolumes }),
	}

	return stringify(config, { lineWidth: 0 })
}
