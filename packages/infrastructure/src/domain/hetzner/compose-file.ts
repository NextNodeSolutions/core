import { stringify } from 'yaml'

import type { ImageRef } from '../deploy/target.ts'

/**
 * Port the application container listens on.
 *
 * Single source of truth - consumed by:
 *   - renderComposeFile (port mapping in compose.yaml)
 *   - CLI deploy command (injected as PORT env var)
 */
export const CONTAINER_PORT = 3000

const HOST_PORT_BASE = 8080

const ENV_PORT_OFFSET: Readonly<Record<string, number>> = {
	production: 0,
	development: 1,
}

export interface ComposeFileInput {
	readonly image: ImageRef
	readonly hostPort: number
}

export function formatImageRef(image: ImageRef): string {
	return `${image.registry}/${image.repository}:${image.tag}`
}

export function computeHostPort(envName: string): number {
	const offset = ENV_PORT_OFFSET[envName]
	if (offset === undefined) {
		throw new Error(
			`Unknown environment "${envName}" for host port computation`,
		)
	}
	return HOST_PORT_BASE + offset
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
