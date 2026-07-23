import { buildCronScheduler } from '#/domain/services/cron.ts'
import {
	OBSERVABILITY_VOLUMES,
	buildObservabilityStack,
} from '#/domain/services/observability.ts'
import {
	POSTGRES_EXPORTER_SERVICE_NAME,
	buildEmbeddedPostgresExporterSidecar,
	buildPostgresExporterInitMount,
} from '#/domain/services/postgres-exporter.ts'
import {
	POSTGRES_WALG_SERVICE_NAME,
	buildPostgresSidecar,
	buildPostgresWalgSidecar,
} from '#/domain/services/postgres-walg.ts'
import {
	POSTGRES_BACKUP_SERVICE_NAME,
	POSTGRES_DATA_VOLUME,
	POSTGRES_SIDECAR_PORT,
	POSTGRES_SIDECAR_SERVICE_NAME,
	buildPostgresBackupSidecar,
	postgresProjectIdentifier,
} from '#/domain/services/postgres.ts'
import { stringify } from 'yaml'

import { buildUserServices } from './compose-user-services.ts'

import type {
	CronJobConfig,
	ObservabilityServiceConfig,
	PostgresServiceConfig,
	UserServiceConfig,
} from '#/config/types.ts'
import type { ImageRef } from '#/domain/deploy/target.ts'
import type { CronComposeService } from '#/domain/services/cron.ts'
import type { ObservabilityComposeService } from '#/domain/services/observability.ts'
import type { EmbeddedPostgresExporterSidecarService } from '#/domain/services/postgres-exporter.ts'
import type {
	PostgresSidecarService,
	PostgresWalgSidecarService,
} from '#/domain/services/postgres-walg.ts'
import type { PostgresBackupSidecarService } from '#/domain/services/postgres.ts'
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
	readonly observability?: ObservabilityServiceConfig | undefined
	// [[deploy.cron]] jobs - rendered as a single `cron` sidecar firing internal
	// HTTP requests at the project's services. Omitted/empty = no sidecar.
	readonly cron?: ReadonlyArray<CronJobConfig>
	readonly projectName: string
	readonly environment: string
}

type ComposeServiceLike =
	| ComposeUserService
	| PostgresSidecarService
	| PostgresWalgSidecarService
	| PostgresBackupSidecarService
	| EmbeddedPostgresExporterSidecarService
	| ObservabilityComposeService
	| CronComposeService

interface ComposeConfig {
	readonly services: Readonly<Record<string, ComposeServiceLike>>
	readonly volumes?: Readonly<Record<string, Record<string, never>>>
}

interface TopLevelVolumesOptions {
	readonly hasPostgres: boolean
	readonly hasObservability: boolean
}

function buildTopLevelVolumes(
	userVolumes: ReadonlyArray<ComposeVolume> = [],
	{ hasPostgres, hasObservability }: TopLevelVolumesOptions,
): Record<string, Record<string, never>> | undefined {
	const volumes: Record<string, Record<string, never>> = {}
	for (const v of userVolumes) volumes[v.name] = {}
	if (hasPostgres) volumes[POSTGRES_DATA_VOLUME] = {}
	if (hasObservability) {
		for (const name of OBSERVABILITY_VOLUMES) volumes[name] = {}
	}
	if (!Object.keys(volumes).length) return undefined
	return volumes
}

/**
 * Build the postgres group (server + wal-g backup loop + exporter) for the
 * compose file. Returns `null` when `mode = external` - the server build helper
 * gates on mode, so this central check keeps the caller free of the per-sidecar
 * null fan-out and lets the spread into `services` stay one-liner clean.
 *
 * The wal-g backup loop is production-only (dev runs zero backups), so it is
 * spread in conditionally; WAL archiving itself rides on the server's
 * archive_command (see `buildPostgresSidecar`). The pg_dump backup sidecar
 * runs IN PARALLEL with wal-g (logical/GFS long-horizon snapshots beside
 * wal-g's PITR window) and is likewise production-only.
 */
function buildPostgresServiceGroup(
	config: PostgresServiceConfig,
	projectName: string,
	environment: string,
): Readonly<Record<string, ComposeServiceLike>> | null {
	const sidecar = buildPostgresSidecar(config, projectName, environment)
	if (sidecar === null) return null
	const walgBackup = buildPostgresWalgSidecar(
		config,
		projectName,
		environment,
	)
	const dumpBackup = buildPostgresBackupSidecar(
		config,
		projectName,
		environment,
	)
	// The bootstrap SQL mount creates the pg_monitor-granted
	// `postgres_exporter` role on first initdb; the exporter sidecar
	// publishes /metrics on the tailnet interface for the monitoring
	// scrape job (PRD P6).
	const instrumentedSidecar: PostgresSidecarService = {
		...sidecar,
		volumes: [...sidecar.volumes, buildPostgresExporterInitMount()],
	}
	const group: Record<string, ComposeServiceLike> = {
		[POSTGRES_SIDECAR_SERVICE_NAME]: instrumentedSidecar,
	}
	if (walgBackup) group[POSTGRES_WALG_SERVICE_NAME] = walgBackup
	if (dumpBackup) group[POSTGRES_BACKUP_SERVICE_NAME] = dumpBackup
	group[POSTGRES_EXPORTER_SERVICE_NAME] =
		buildEmbeddedPostgresExporterSidecar(
			POSTGRES_SIDECAR_SERVICE_NAME,
			POSTGRES_SIDECAR_PORT,
			postgresProjectIdentifier(projectName),
		)
	return group
}

export function renderComposeFile(input: ComposeFileInput): string {
	const userVolumes = input.volumes?.length ? input.volumes : undefined
	const postgres = input.postgres
		? buildPostgresServiceGroup(
				input.postgres,
				input.projectName,
				input.environment,
			)
		: null
	const observability = input.observability
		? buildObservabilityStack(input.observability)
		: null
	const cron = buildCronScheduler(input.cron ?? [], input.services)
	const topLevelVolumes = buildTopLevelVolumes(userVolumes, {
		hasPostgres: postgres !== null,
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
			...observability,
			...cron,
		},
		...(topLevelVolumes && { volumes: topLevelVolumes }),
	}

	return stringify(config, { lineWidth: 0 })
}
