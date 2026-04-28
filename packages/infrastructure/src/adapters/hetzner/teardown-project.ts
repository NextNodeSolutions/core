import { extractRootDomain } from '#/domain/cloudflare/dns-records.ts'
import { buildR2CaddyBinding } from '#/domain/cloudflare/r2/caddy-binding.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { DnsClient } from '#/domain/dns/client.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { CaddyUpstream } from '#/domain/hetzner/caddy-config.ts'
import { extractUpstreams } from '#/domain/hetzner/caddy-config.ts'
import { buildCaddyForProject } from '#/domain/hetzner/caddy-for-project.ts'
import { computeSilo } from '#/domain/hetzner/env-silo.ts'
import type { ObjectStoreClient } from '#/domain/storage/object-store.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { CADDY_CONFIG_PATH } from './constants.ts'
import type { SshSession } from './ssh/session.types.ts'
import { shellEscape } from './ssh/shell-escape.ts'
import { writeState } from './state/read-write.ts'
import type {
	HcloudConvergedState,
	HcloudProvisionedState,
} from './state/types.ts'

const logger = createLogger()

const EMPTY_CADDY_CONFIG = JSON.stringify({
	apps: { http: { servers: {} } },
})

export interface TeardownCaddyContext {
	readonly vpsName: string
	readonly infraStorage: InfraStorageRuntimeConfig
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
						storage: buildR2CaddyBinding(
							caddy.infraStorage,
							caddy.vpsName,
						),
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
	certsR2: ObjectStoreClient,
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
 * Free the project's allocated host port back into the pool by removing
 * its entry from the persisted `state.hostPorts` map under the same R2
 * ETag lock used during provisioning, so a future deploy of a different
 * project on this VPS can reuse the freed port.
 *
 * Idempotent: returns `not allocated` when the project has no entry.
 */
export async function releaseProjectHostPort(
	r2: ObjectStoreClient,
	vpsName: string,
	projectName: string,
	state: HcloudProvisionedState | HcloudConvergedState,
	etag: string,
): Promise<ResourceOutcome> {
	const port = state.hostPorts[projectName]
	if (port === undefined) {
		return { handled: false, detail: 'no port allocated' }
	}
	const remaining: Record<string, number> = {}
	for (const [project, allocated] of Object.entries(state.hostPorts)) {
		if (project !== projectName) remaining[project] = allocated
	}
	const updated: HcloudProvisionedState | HcloudConvergedState = {
		...state,
		hostPorts: remaining,
	}
	await writeState(r2, vpsName, updated, etag)
	logger.info(
		`Released host port ${String(port)} for "${projectName}" on VPS "${vpsName}"`,
	)
	return { handled: true, detail: `port ${String(port)} released` }
}

/**
 * Delete the DNS record(s) for a single project hostname. Used by project
 * teardown — does NOT touch sibling projects on the same VPS.
 */
export async function teardownProjectDns(
	projectHostname: string | undefined,
	dns: DnsClient,
): Promise<ResourceOutcome> {
	if (!projectHostname) {
		return { handled: false, detail: 'no domain configured' }
	}
	const deletedCount = await dns.deleteByName([
		{
			zoneName: extractRootDomain(projectHostname),
			name: projectHostname,
		},
	])
	return {
		handled: deletedCount > 0,
		detail: `${String(deletedCount)} record(s) deleted`,
	}
}
