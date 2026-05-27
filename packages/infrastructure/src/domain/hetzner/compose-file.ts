import type {
	PostgresServiceConfig,
	SupabaseServiceConfig,
} from '#/config/types.ts'
import type { ImageRef } from '#/domain/deploy/target.ts'
import type { PostgresExporterSidecarService } from '#/domain/services/postgres-exporter.ts'
import {
	POSTGRES_EXPORTER_SERVICE_NAME,
	buildPostgresExporterInitMount,
	buildPostgresExporterSidecar,
} from '#/domain/services/postgres-exporter.ts'
import type {
	PostgresBackupSidecarService,
	PostgresSidecarService,
} from '#/domain/services/postgres.ts'
import {
	POSTGRES_BACKUP_SERVICE_NAME,
	POSTGRES_DATA_VOLUME,
	POSTGRES_SIDECAR_SERVICE_NAME,
	buildPostgresBackupSidecar,
	buildPostgresSidecar,
} from '#/domain/services/postgres.ts'
import type {
	SupabaseService,
	SupabaseStack,
} from '#/domain/services/supabase.ts'
import {
	SUPABASE_DB_DATA_VOLUME,
	SUPABASE_DB_SERVICE_NAME,
	buildSupabaseStack,
} from '#/domain/services/supabase.ts'
import { stringify } from 'yaml'

/**
 * Port the application container listens on.
 *
 * Single source of truth - consumed by:
 *   - renderComposeFile (port mapping in compose.yaml)
 *   - CLI deploy command (injected as PORT env var)
 */
export const CONTAINER_PORT = 3000

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
	readonly image: ImageRef
	readonly hostPort: number
	readonly volumes?: ReadonlyArray<ComposeVolume>
	readonly postgres: PostgresServiceConfig | undefined
	readonly supabase?: SupabaseServiceConfig
	readonly projectName: string
}

export function formatImageRef(image: ImageRef): string {
	return `${image.registry}/${image.repository}:${image.tag}`
}

interface ComposeServiceDependency {
	readonly condition: 'service_healthy'
}

interface ComposeService {
	readonly image: string
	readonly restart: string
	readonly env_file: ReadonlyArray<string>
	readonly ports: ReadonlyArray<string>
	readonly volumes?: ReadonlyArray<string>
	readonly depends_on?: Readonly<Record<string, ComposeServiceDependency>>
}

type ComposeServiceLike =
	| ComposeService
	| PostgresSidecarService
	| PostgresBackupSidecarService
	| SupabaseService
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

export function renderComposeFile(input: ComposeFileInput): string {
	const userVolumes = input.volumes?.length ? input.volumes : undefined
	const postgresSidecar = input.postgres
		? buildPostgresSidecar(input.postgres, input.projectName)
		: null
	const postgresBackupSidecar = input.postgres
		? buildPostgresBackupSidecar(input.postgres, input.projectName)
		: null
	const supabaseStack = input.supabase
		? withPostgresExporterInitMount(buildSupabaseStack())
		: null
	const postgresExporterSidecar = input.supabase
		? buildPostgresExporterSidecar()
		: null

	const topLevelVolumes = buildTopLevelVolumes(
		userVolumes,
		postgresSidecar !== null,
		supabaseStack !== null,
	)

	const config: ComposeConfig = {
		services: {
			app: {
				image: formatImageRef(input.image),
				restart: 'unless-stopped',
				env_file: ['.env'],
				ports: [`127.0.0.1:${input.hostPort}:${CONTAINER_PORT}`],
				...(userVolumes && {
					volumes: userVolumes.map(v => `${v.name}:${v.mount}`),
				}),
				...(postgresSidecar && {
					depends_on: {
						[POSTGRES_SIDECAR_SERVICE_NAME]: {
							condition: 'service_healthy',
						},
					},
				}),
			},
			...(postgresSidecar && {
				[POSTGRES_SIDECAR_SERVICE_NAME]: postgresSidecar,
			}),
			...(postgresBackupSidecar && {
				[POSTGRES_BACKUP_SERVICE_NAME]: postgresBackupSidecar,
			}),
			...supabaseStack,
			...(postgresExporterSidecar && {
				[POSTGRES_EXPORTER_SERVICE_NAME]: postgresExporterSidecar,
			}),
		},
		...(topLevelVolumes && { volumes: topLevelVolumes }),
	}

	return stringify(config, { lineWidth: 0 })
}
