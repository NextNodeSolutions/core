import { createLogger } from '@nextnode-solutions/logger'

import type { ResourceOutcome } from '@/domain/deploy/resource-outcome.ts'
import type { AppEnvironment } from '@/domain/environment.ts'
import { extractUpstreams } from '@/domain/hetzner/caddy-config.ts'
import { computeSilo } from '@/domain/hetzner/env-silo.ts'
import type { ObjectStoreClient } from '@/domain/storage/object-store.ts'

import { CADDY_CONFIG_PATH } from './constants.ts'
import type { SshSession } from './ssh/session.types.ts'
import { shellEscape } from './ssh/shell-escape.ts'

const logger = createLogger()

const EMPTY_CADDY_CONFIG = JSON.stringify({
	apps: { http: { servers: {} } },
})

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
 * Remove the project's route from Caddy and reload.
 *
 * Today's 1:1 assumption: a VPS hosts a single project. Once colocation
 * (N projects per VPS) is implemented on the deploy side, this helper MUST
 * be updated to rebuild the Caddy config from the remaining upstreams
 * instead of clearing it. Until then, fail loud if we detect routes for
 * other projects so we never silently break a colocated deployment.
 */
export async function teardownProjectCaddyRoute(
	session: SshSession,
	projectHostname: string | undefined,
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

	const remaining = upstreams.filter(u => u.hostname !== projectHostname)
	if (remaining.length > 0) {
		throw new Error(
			`Caddy config has ${String(remaining.length)} route(s) for other projects — colocation teardown not yet supported`,
		)
	}

	await session.writeFile(CADDY_CONFIG_PATH, EMPTY_CADDY_CONFIG)
	await session.exec(`caddy reload --config ${CADDY_CONFIG_PATH}`)
	logger.info(`Caddy route for "${projectHostname}" removed`)
	return { handled: true, detail: 'route removed, Caddy reloaded' }
}

/**
 * Delete every R2 object under the project's certs prefix.
 *
 * Caddy stores ACME certificates in the certs bucket under
 * `<projectName>/` (see buildCaddyForProject). Wiping the prefix ensures
 * a fresh re-deploy cannot reuse stale cert material tied to the torn-down
 * project.
 */
export async function teardownProjectCerts(
	certsR2: ObjectStoreClient,
	projectName: string,
): Promise<ResourceOutcome> {
	const prefix = `${projectName}/`
	const deletedCount = await certsR2.deleteByPrefix(prefix)
	return {
		handled: deletedCount > 0,
		detail: `${String(deletedCount)} cert object(s) deleted`,
	}
}
