import { createLogger } from '@nextnode-solutions/logger'

import { extractRootDomain } from '../../domain/cloudflare/dns-records.ts'
import type { R2RuntimeConfig } from '../../domain/cloudflare/r2/runtime-config.ts'
import type { ResourceOutcome } from '../../domain/deploy/resource-outcome.ts'
import type { AppEnvironment } from '../../domain/environment.ts'
import { extractUpstreams } from '../../domain/hetzner/caddy-config.ts'
import type { CaddyUpstream } from '../../domain/hetzner/caddy-config.ts'
import { buildCaddyForProject } from '../../domain/hetzner/caddy-for-project.ts'
import { computeSilo } from '../../domain/hetzner/env-silo.ts'
import { deleteDnsRecordsByName } from '../cloudflare/dns/delete-records.ts'
import type { R2Operations } from '../r2/client.types.ts'

import { CADDY_CONFIG_PATH } from './constants.ts'
import type { SshSession } from './ssh/session.types.ts'
import { shellEscape } from './ssh/shell-escape.ts'

const logger = createLogger()

const EMPTY_CADDY_CONFIG = JSON.stringify({
	apps: { http: { servers: {} } },
})

export interface TeardownCaddyContext {
	readonly vpsName: string
	readonly r2: R2RuntimeConfig
	readonly acmeEmail: string
	readonly internal: boolean
}

/**
 * Stop and remove the project's docker-compose stack, then delete the bind
 * mount that holds its compose.yaml, .env, and any volume data.
 *
 * Safe to run when the stack was never deployed — missing compose file is
 * reported as `not deployed` rather than an error.
 */
export async function teardownProjectContainer(
	session: SshSession,
	projectName: string,
	environment: AppEnvironment,
): Promise<ResourceOutcome> {
	const silo = computeSilo(projectName, environment)
	const envDir = `/opt/apps/${projectName}/${environment}`
	const composeFile = `${envDir}/compose.yaml`

	const composeContent = await session.readFile(composeFile)
	if (composeContent === null) {
		return { handled: false, detail: 'not deployed' }
	}

	await session.exec(
		`docker compose -p ${shellEscape(silo.id)} -f ${shellEscape(composeFile)} down -v --remove-orphans`,
	)
	await session.exec(`rm -rf ${shellEscape(envDir)}`)
	logger.info(`Container stack ${silo.id} removed`)
	return { handled: true, detail: 'stack and bind mount removed' }
}

/**
 * Remove a single project's route from the shared Caddy config on the VPS
 * and reload. Other projects' routes are preserved.
 *
 * If this is the last project on the VPS, Caddy is reset to an empty
 * server config (no upstreams) but kept running so the VPS remains ready
 * for the next deploy.
 */
export async function teardownProjectCaddyRoute(
	session: SshSession,
	projectHostname: string | undefined,
	caddy: TeardownCaddyContext,
): Promise<ResourceOutcome> {
	if (!projectHostname) {
		return { handled: false, detail: 'no domain configured' }
	}

	const currentConfig = await session.readFile(CADDY_CONFIG_PATH)
	if (currentConfig === null) {
		return { handled: false, detail: 'no caddy config' }
	}

	const upstreams = extractUpstreams(currentConfig)
	const hasProjectRoute = upstreams.some(u => u.hostname === projectHostname)
	if (!hasProjectRoute) {
		return { handled: false, detail: 'no route for project hostname' }
	}

	const remaining: ReadonlyArray<CaddyUpstream> = upstreams.filter(
		u => u.hostname !== projectHostname,
	)

	const nextConfig =
		remaining.length === 0
			? EMPTY_CADDY_CONFIG
			: JSON.stringify(
					buildCaddyForProject({
						projectName: caddy.vpsName,
						r2: caddy.r2,
						upstreams: remaining,
						acmeEmail: caddy.acmeEmail,
						internal: caddy.internal,
					}),
				)

	await session.writeFile(CADDY_CONFIG_PATH, nextConfig)
	await session.exec(`caddy reload --config ${CADDY_CONFIG_PATH}`)
	logger.info(
		`Caddy route for "${projectHostname}" removed (${String(remaining.length)} upstream(s) remaining on VPS "${caddy.vpsName}")`,
	)
	return { handled: true, detail: 'route removed, Caddy reloaded' }
}

/**
 * Delete the project's ACME cert objects from R2 without touching sibling
 * projects' certs.
 *
 * Caddy storage layout under the per-VPS prefix:
 *   ${vpsName}/certificates/{ca-id}/{hostname}/{hostname}.{json,key,crt}
 *
 * The CA id (e.g. `acme-v02.api.letsencrypt.org-directory`) is unstable
 * across CA fallbacks, so we list everything under
 * `${vpsName}/certificates/` and filter keys containing `/${hostname}/`
 * or ending with `/${hostname}.<ext>`.
 */
export async function teardownProjectCerts(
	certsR2: R2Operations,
	vpsName: string,
	projectHostname: string | undefined,
): Promise<ResourceOutcome> {
	if (!projectHostname) {
		return { handled: false, detail: 'no domain configured' }
	}
	const listPrefix = `${vpsName}/certificates/`
	const hostSegment = `/${projectHostname}/`
	const hostFilePrefix = `/${projectHostname}.`
	const deletedCount = await certsR2.deleteByPrefix(
		listPrefix,
		key => key.includes(hostSegment) || key.includes(hostFilePrefix),
	)
	logger.info(
		`R2 certs purged for "${projectHostname}" on VPS "${vpsName}" (${String(deletedCount)} object(s))`,
	)
	return {
		handled: deletedCount > 0,
		detail: `${String(deletedCount)} cert object(s) deleted`,
	}
}

/**
 * Delete the DNS record(s) for a single project hostname. Used by project
 * teardown — does NOT touch sibling projects on the same VPS.
 */
export async function teardownProjectDns(
	projectHostname: string | undefined,
	cloudflareApiToken: string,
): Promise<ResourceOutcome> {
	if (!projectHostname) {
		return { handled: false, detail: 'no domain configured' }
	}
	const deletedCount = await deleteDnsRecordsByName(
		[
			{
				zoneName: extractRootDomain(projectHostname),
				name: projectHostname,
			},
		],
		cloudflareApiToken,
	)
	return {
		handled: deletedCount > 0,
		detail: `${String(deletedCount)} record(s) deleted`,
	}
}
