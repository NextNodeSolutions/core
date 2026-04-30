import type { ImageRef } from '#/domain/deploy/target.ts'
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
	}
	readonly volumes?: Readonly<Record<string, Record<string, never>>>
}

export function renderComposeFile(input: ComposeFileInput): string {
	const volumes = input.volumes?.length ? input.volumes : undefined

	const config: ComposeConfig = {
		services: {
			app: {
				image: formatImageRef(input.image),
				restart: 'unless-stopped',
				env_file: ['.env'],
				ports: [`127.0.0.1:${input.hostPort}:${CONTAINER_PORT}`],
				...(volumes && {
					volumes: volumes.map(v => `${v.name}:${v.mount}`),
				}),
			},
		},
		...(volumes && {
			volumes: Object.fromEntries(volumes.map(v => [v.name, {}])),
		}),
	}

	return stringify(config, { lineWidth: 0 })
}
