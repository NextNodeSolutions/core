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
	const volumes =
		input.volumes !== undefined && input.volumes.length > 0
			? input.volumes
			: undefined

	const app: ComposeService = {
		image: formatImageRef(input.image),
		restart: 'unless-stopped',
		env_file: ['.env'],
		ports: [`127.0.0.1:${input.hostPort}:${CONTAINER_PORT}`],
		...(volumes && {
			volumes: volumes.map(v => `${v.name}:${v.mount}`),
		}),
	}

	const emptyMount: Record<string, never> = {}
	const config: ComposeConfig = {
		services: { app },
		...(volumes && {
			volumes: Object.fromEntries(volumes.map(v => [v.name, emptyMount])),
		}),
	}

	return stringify(config, { lineWidth: 0 })
}
