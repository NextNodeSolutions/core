import { CADDY_CONFIG_PATH } from '#/adapters/hetzner/constants.ts'
import { vectorInstallCommands } from '#/domain/hetzner/golden-image.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { SshSession } from '#/adapters/hetzner/ssh/session.types.ts'

const logger = createLogger()

const VECTOR_TOML_PATH = '/etc/vector/vector.toml'
const VECTOR_ENV_PATH = '/etc/vector/vector.env'
const MONITORING_ENV_PATH = '/etc/monitoring/env'

export interface ConvergenceInput {
	readonly vpsName: string
	readonly vectorToml: string | undefined
	readonly vectorEnv: string | undefined
	readonly caddyConfig: string
	// /etc/monitoring/env content (TS_IP=<tailnet ip>) - written before
	// the cadvisor unit (shipped disabled in the golden image) is enabled.
	readonly monitoringEnv: string
}

async function pushFileIfChanged(
	session: SshSession,
	remotePath: string,
	desired: string,
): Promise<boolean> {
	const current = await session.readFile(remotePath)
	if (current === desired) return false

	await session.writeFile(remotePath, desired)
	logger.info(`Updated ${remotePath}`)
	return true
}

/**
 * cAdvisor: write the TS_IP env file the golden-image unit reads, then
 * (re)enable it. `/etc/monitoring` is created defensively (owned by `deploy` so
 * the sftp write succeeds) for VPSes whose golden image predates that step. The
 * `enable --now` is tolerated if it fails: a VPS whose image predates the
 * cadvisor unit must not fail the whole deploy - the agent arrives when the VPS
 * is recreated from a current golden image. A changed IP (VPS recreation) needs
 * the restart to re-bind the publish address.
 */
async function convergeCadvisor(
	session: SshSession,
	monitoringEnv: string,
): Promise<void> {
	await session.exec(
		'sudo mkdir -p /etc/monitoring && sudo chown deploy:deploy /etc/monitoring',
	)
	const monitoringEnvChanged = await pushFileIfChanged(
		session,
		MONITORING_ENV_PATH,
		monitoringEnv,
	)
	const cadvisorEnabled = await session
		.exec('sudo systemctl enable --now cadvisor')
		.then(() => true)
		.catch(() => false)
	if (!cadvisorEnabled) {
		logger.warn(
			'cadvisor unit unavailable on this VPS (golden image predates the monitoring agents) - skipping; recreate the VPS from a current golden image to enable per-VPS metrics',
		)
		return
	}
	if (monitoringEnvChanged) {
		await session.exec('sudo systemctl restart cadvisor')
		logger.info('Restarted cadvisor')
	}
}

// Self-heal the Vector binary: a VPS whose golden image snapshot predates (or
// silently lost) the Vector install has the unit + config but no
// /usr/bin/vector, so vector.service crash-loops with "No such file or
// directory". Install the pinned binary on demand. Returns whether it was just
// installed (so the caller restarts even when the config is unchanged).
// Non-fatal: a failed install is warned, not deploy-breaking (cadvisor stance).
async function ensureVectorBinary(session: SshSession): Promise<boolean> {
	const probe = await session.exec(
		'command -v vector >/dev/null 2>&1 && echo yes || echo no',
	)
	if (probe.trim() === 'yes') return false

	const installed = await session
		.exec(vectorInstallCommands('sudo').join(' && '))
		.then(() => true)
		.catch(() => false)
	logger[installed ? 'info' : 'warn'](
		installed
			? 'Installed missing Vector binary (snapshot predates/lost it)'
			: 'Vector binary missing and install failed - log shipping stays down until the golden image ships it',
	)
	return installed
}

export async function converge(
	session: SshSession,
	input: ConvergenceInput,
): Promise<void> {
	// Vector config - skipped when log sink (NN_VL_URL) is unknown at provision time.
	// Re-run convergence once VL is reachable; this is the hot-update path.
	if (input.vectorToml !== undefined && input.vectorEnv !== undefined) {
		const vectorInstalled = await ensureVectorBinary(session)
		const vectorTomlChanged = await pushFileIfChanged(
			session,
			VECTOR_TOML_PATH,
			input.vectorToml,
		)
		const vectorEnvChanged = await pushFileIfChanged(
			session,
			VECTOR_ENV_PATH,
			input.vectorEnv,
		)

		if (vectorInstalled || vectorTomlChanged || vectorEnvChanged) {
			await session.exec('sudo systemctl restart vector')
			logger.info('Restarted vector')
		}
	} else {
		logger.info('Skipping Vector config (NN_VL_URL not set)')
	}

	// Caddy base config
	const caddyChanged = await pushFileIfChanged(
		session,
		CADDY_CONFIG_PATH,
		input.caddyConfig,
	)

	if (caddyChanged) {
		await session.exec('sudo systemctl restart caddy')
		logger.info('Restarted caddy')
	}

	await convergeCadvisor(session, input.monitoringEnv)

	// Per-project directories are created on demand by deployContainer when
	// each project deploys onto this VPS. Convergence is purely VPS-level.

	logger.info(`Convergence complete for VPS "${input.vpsName}"`)
}
