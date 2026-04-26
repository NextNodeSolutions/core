import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'

import {
	CADDY_ENV_CF_API_TOKEN,
	CADDY_ENV_R2_SECRET_KEY,
} from './caddy-config.ts'

export interface CaddyEnvInput {
	readonly infraStorage: InfraStorageRuntimeConfig
	readonly cloudflareApiToken: string
}

/**
 * Absolute path the Caddy systemd unit reads via `EnvironmentFile=`.
 *
 * The file is written with 0600 perms and root ownership so only the Caddy
 * process can read the R2 secret key and Cloudflare DNS API token. The JSON
 * config references these as `{env.X}` placeholders — secrets therefore never
 * land in `/etc/caddy/config.json` (which must be world-readable for reloads).
 */
export const CADDY_ENV_PATH = '/etc/caddy/env'

function rejectNewline(name: string, value: string): string {
	if (value.includes('\n') || value.includes('\r')) {
		throw new Error(
			`caddy-env: value for "${name}" contains a newline — rejected to prevent env file injection`,
		)
	}
	return value
}

export function renderCaddyEnv(input: CaddyEnvInput): string {
	return [
		`${CADDY_ENV_R2_SECRET_KEY}=${rejectNewline(CADDY_ENV_R2_SECRET_KEY, input.infraStorage.secretAccessKey)}`,
		`${CADDY_ENV_CF_API_TOKEN}=${rejectNewline(CADDY_ENV_CF_API_TOKEN, input.cloudflareApiToken)}`,
	].join('\n')
}
