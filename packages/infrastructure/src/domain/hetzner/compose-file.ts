import type { PostgresServiceConfig } from '#/config/types.ts'
import type { ImageRef } from '#/domain/deploy/target.ts'
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
	readonly postgres?: PostgresServiceConfig
	readonly projectName: string
}

export function formatImageRef(image: ImageRef): string {
	return `${image.registry}/${image.repository}:${image.tag}`
}

interface ComposeService {
	readonly image: string
	readonly restart: string
	readonly env_file: ReadonlyArray<string>
	readonly ports: ReadonlyArray<string>
	readonly volumes?: ReadonlyArray<string>
}

interface ComposeConfig {
	readonly services: {
		readonly app: ComposeService
		readonly [POSTGRES_SIDECAR_SERVICE_NAME]?: PostgresSidecarService
		readonly [POSTGRES_BACKUP_SERVICE_NAME]?: PostgresBackupSidecarService
	}
	readonly volumes?: Readonly<Record<string, Record<string, never>>>
}

function buildTopLevelVolumes(
	userVolumes: ReadonlyArray<ComposeVolume> = [],
	includePostgres: boolean,
): Record<string, Record<string, never>> | undefined {
	const result: Record<string, Record<string, never>> = {}
	for (const v of userVolumes) result[v.name] = {}
	if (includePostgres) result[POSTGRES_DATA_VOLUME] = {}
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

	const topLevelVolumes = buildTopLevelVolumes(
		userVolumes,
		postgresSidecar !== null,
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
			},
			...(postgresSidecar && {
				[POSTGRES_SIDECAR_SERVICE_NAME]: postgresSidecar,
			}),
			...(postgresBackupSidecar && {
				[POSTGRES_BACKUP_SERVICE_NAME]: postgresBackupSidecar,
			}),
		},
		...(topLevelVolumes && { volumes: topLevelVolumes }),
	}

	return stringify(config, { lineWidth: 0 })
}
