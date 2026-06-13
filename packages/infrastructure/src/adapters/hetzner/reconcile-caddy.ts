import { composeCaddyConfig } from '#/domain/caddy/compose.ts'
import { extractUpstreams } from '#/domain/caddy/config.ts'
import { CADDY_ENV_PATH, renderCaddyEnv } from '#/domain/caddy/env.ts'
import { buildR2CaddyBinding } from '#/domain/cloudflare/r2/caddy-binding.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { CADDY_CONFIG_PATH } from './constants.ts'

import type { CaddyUpstream } from '#/domain/caddy/config.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { SshSession } from './ssh/session.types.ts'

const logger = createLogger()

export interface ReconcileCaddyInput {
	readonly vpsName: string
	readonly internal: boolean
	readonly infraStorage: InfraStorageRuntimeConfig
	readonly acmeEmail: string
	readonly cloudflareApiToken: string
}

/**
 * Multi-tenant Caddy reconfiguration: read the existing config, drop any
 * prior upstreams for THIS project's hostnames (re-deploy case), then add
 * the fresh ones. Upstreams from other projects on this VPS are preserved
 * untouched.
 */
export async function reconcileCaddy(
	session: SshSession,
	input: ReconcileCaddyInput,
	upstreams: ReadonlyArray<CaddyUpstream>,
): Promise<void> {
	const { vpsName } = input
	const existingConfig = await session.readFile(CADDY_CONFIG_PATH)
	const existingUpstreams = extractUpstreams(existingConfig ?? '')
	const deployedHostnames = new Set(upstreams.map(u => u.hostname))
	const otherUpstreams = existingUpstreams.filter(
		u => !deployedHostnames.has(u.hostname),
	)
	const mergedUpstreams = [...otherUpstreams, ...upstreams]

	const caddyConfig = JSON.stringify(
		composeCaddyConfig({
			storage: buildR2CaddyBinding(input.infraStorage, vpsName),
			upstreams: mergedUpstreams,
			acmeEmail: input.acmeEmail,
			internal: input.internal,
		}),
	)

	// Refresh the env file so Caddy resolves the latest R2 + CF
	// secrets via {env.X} placeholders. Caddy re-reads EnvironmentFile
	// on systemctl restart only, so a rotation needs a restart - but
	// for normal deploys the values are unchanged and `caddy reload`
	// suffices.
	await session.writeFile(
		CADDY_ENV_PATH,
		renderCaddyEnv({
			infraStorage: input.infraStorage,
			cloudflareApiToken: input.cloudflareApiToken,
		}),
	)
	await session.writeFile(CADDY_CONFIG_PATH, caddyConfig)
	await session.exec(`caddy reload --config ${CADDY_CONFIG_PATH}`)
	logger.info(
		`Caddy reloaded on VPS "${vpsName}" with ${String(mergedUpstreams.length)} upstream(s)`,
	)
}
