import {
	OBSERVABILITY_VOLUMES,
	buildObservabilityStack,
} from '#/domain/services/observability.ts'
import {
	POSTGRES_EXPORTER_SERVICE_NAME,
	buildEmbeddedPostgresExporterSidecar,
	buildPostgresExporterInitMount,
	buildPostgresExporterSidecar,
} from '#/domain/services/postgres-exporter.ts'
import {
	POSTGRES_BACKUP_SERVICE_NAME,
	POSTGRES_DATA_VOLUME,
	POSTGRES_SIDECAR_PORT,
	POSTGRES_SIDECAR_SERVICE_NAME,
	buildPostgresBackupSidecar,
	buildPostgresSidecar,
	postgresProjectIdentifier,
} from '#/domain/services/postgres.ts'
import {
	SUPABASE_BACKUP_SERVICE_NAME,
	SUPABASE_DB_DATA_VOLUME,
	SUPABASE_DB_SERVICE_NAME,
	buildSupabaseBackupSidecar,
	buildSupabaseStack,
} from '#/domain/services/supabase.ts'
import { stringify } from 'yaml'

import { buildUserServices } from './compose-user-services.ts'

import type {
	ObservabilityServiceConfig,
	PostgresServiceConfig,
	SupabaseServiceConfig,
	UserServiceConfig,
} from '#/config/types.ts'
import type { ImageRef } from '#/domain/deploy/target.ts'
import type { ObservabilityComposeService } from '#/domain/services/observability.ts'
import type {
	EmbeddedPostgresExporterSidecarService,
	PostgresExporterSidecarService,
} from '#/domain/services/postgres-exporter.ts'
import type {
	PostgresBackupSidecarService,
	PostgresSidecarService,
} from '#/domain/services/postgres.ts'
import type {
	SupabaseBackupSidecarService,
	SupabaseService,
	SupabaseStack,
} from '#/domain/services/supabase.ts'
import type { ComposeUserService } from './compose-user-services.ts'

/**
 * A Docker named volume managed by the Docker daemon on the VPS local SSD
 * (under `/var/lib/docker/volumes/...`). NOT a Hetzner Block Volume -
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
	// Allocated host port per service - consulted only for `url` services.
	readonly hostPorts: Readonly<Record<string, number>>
	readonly volumes?: ReadonlyArray<ComposeVolume>
	readonly postgres: PostgresServiceConfig | undefined
	readonly supabase?: SupabaseServiceConfig
	readonly observability?: ObservabilityServiceConfig | undefined
	readonly projectName: string
	readonly environment: string
}

type ComposeServiceLike =
	| ComposeUserService
	| PostgresSidecarService
	| PostgresBackupSidecarService
	| SupabaseService
	| SupabaseBackupSidecarService
	| PostgresExporterSidecarService
	| EmbeddedPostgresExporterSidecarService
	| ObservabilityComposeService

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

interface TopLevelVolumesOptions {
	readonly hasPostgres: boolean
	readonly hasSupabase: boolean
	readonly hasObservability: boolean
}

function buildTopLevelVolumes(
	userVolumes: ReadonlyArray<ComposeVolume> = [],
	{ hasPostgres, hasSupabase, hasObservability }: TopLevelVolumesOptions,
): Record<string, Record<string, never>> | undefined {
	const volumes: Record<string, Record<string, never>> = {}
	for (const v of userVolumes) volumes[v.name] = {}
	if (hasPostgres) volumes[POSTGRES_DATA_VOLUME] = {}
	if (hasSupabase) volumes[SUPABASE_DB_DATA_VOLUME] = {}
	if (hasObservability) {
		for (const name of OBSERVABILITY_VOLUMES) volumes[name] = {}
	}
	return Object.keys(volumes).length ? volumes : undefined
}

/**
 * Build the postgres group (sidecar + backup) for the compose file.
 * Returns `null` when `mode = external` - the build helpers also gate on
 * mode, so this central check keeps the caller free of the per-sidecar
 * null fan-out and lets the spread into `services` stay one-liner clean.
 */
function buildPostgresServiceGroup(
	config: PostgresServiceConfig,
	projectName: string,
	hasSupabase: boolean,
): Readonly<Record<string, ComposeServiceLike>> | null {
	const sidecar = buildPostgresSidecar(config, projectName)
	const backup = buildPostgresBackupSidecar(config, projectName)
	if (sidecar === null || backup === null) return null
	// The bootstrap SQL mount creates the pg_monitor-granted
	// `postgres_exporter` role on first initdb; the exporter sidecar
	// publishes /metrics on the tailnet interface for the monitoring
	// scrape job (PRD P6 - embedded postgres gets the same observability
	// as the Supabase variant). When the project ALSO declares supabase,
	// the supabase group already owns the `postgres-exporter` name and
	// the 9187 tailnet bind - one exporter per VPS port, supabase wins.
	const instrumentedSidecar: PostgresSidecarService = {
		...sidecar,
		volumes: [...sidecar.volumes, buildPostgresExporterInitMount()],
	}
	return {
		[POSTGRES_SIDECAR_SERVICE_NAME]: instrumentedSidecar,
		[POSTGRES_BACKUP_SERVICE_NAME]: backup,
		...(hasSupabase
			? {}
			: {
					[POSTGRES_EXPORTER_SERVICE_NAME]:
						buildEmbeddedPostgresExporterSidecar(
							POSTGRES_SIDECAR_SERVICE_NAME,
							POSTGRES_SIDECAR_PORT,
							postgresProjectIdentifier(projectName),
						),
				}),
	}
}

/**
 * Build the supabase group (six-service stack + postgres-exporter +
 * backup sidecar) for the compose file. Always non-null when called -
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

export function renderComposeFile(input: ComposeFileInput): string {
	const userVolumes = input.volumes?.length ? input.volumes : undefined
	const postgres = input.postgres
		? buildPostgresServiceGroup(
				input.postgres,
				input.projectName,
				input.supabase !== undefined,
			)
		: null
	const supabase = input.supabase
		? buildSupabaseServiceGroup(input.projectName, input.environment)
		: null
	const observability = input.observability
		? buildObservabilityStack(input.observability)
		: null
	const topLevelVolumes = buildTopLevelVolumes(userVolumes, {
		hasPostgres: postgres !== null,
		hasSupabase: supabase !== null,
		hasObservability: observability !== null,
	})

	const config: ComposeConfig = {
		services: {
			...buildUserServices({
				services: input.services,
				images: input.images,
				hostPorts: input.hostPorts,
				userVolumes,
				hasPostgres: postgres !== null,
			}),
			...postgres,
			...supabase,
			...observability,
		},
		...(topLevelVolumes && { volumes: topLevelVolumes }),
	}

	return stringify(config, { lineWidth: 0 })
}
