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

export interface ComposeFileInput {
	readonly image: ImageRef
	readonly hostPort: number
}

export function formatImageRef(image: ImageRef): string {
	return `${image.registry}/${image.repository}:${image.tag}`
}

interface ComposeConfig {
	readonly services: {
		readonly app: {
			readonly image: string
			readonly restart: string
			readonly env_file: ReadonlyArray<string>
			readonly ports: ReadonlyArray<string>
		}
	}
}

export function renderComposeFile(input: ComposeFileInput): string {
	const config: ComposeConfig = {
		services: {
			app: {
				image: formatImageRef(input.image),
				restart: 'unless-stopped',
				env_file: ['.env'],
				ports: [`127.0.0.1:${input.hostPort}:${CONTAINER_PORT}`],
			},
		},
	}

	return stringify(config, { lineWidth: 0 })
}
