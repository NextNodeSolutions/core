import { CADDY_CONFIG_PATH } from '#/adapters/hetzner/constants.ts'
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

export async function converge(
	session: SshSession,
	input: ConvergenceInput,
): Promise<void> {
	// Vector config - skipped when log sink (NN_VL_URL) is unknown at provision time.
	// Re-run convergence once VL is reachable; this is the hot-update path.
	if (input.vectorToml !== undefined && input.vectorEnv !== undefined) {
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

		if (vectorTomlChanged || vectorEnvChanged) {
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

	// cAdvisor: write the TS_IP env file the golden-image unit reads,
	// then (re)enable it. `enable --now` is idempotent; a changed IP
	// (VPS recreation) needs the restart to re-bind the publish address.
	//
	// Create /etc/monitoring defensively (owned by `deploy` so the sftp write
	// below succeeds): the golden image does this, but VPSes provisioned from an
	// image predating that step lack the directory and the write would fail with
	// "No such file". Idempotent on a current golden image.
	await session.exec(
		'sudo mkdir -p /etc/monitoring && sudo chown deploy:deploy /etc/monitoring',
	)
	const monitoringEnvChanged = await pushFileIfChanged(
		session,
		MONITORING_ENV_PATH,
		input.monitoringEnv,
	)
	await session.exec('sudo systemctl enable --now cadvisor')
	if (monitoringEnvChanged) {
		await session.exec('sudo systemctl restart cadvisor')
		logger.info('Restarted cadvisor')
	}

	// Per-project directories are created on demand by deployContainer when
	// each project deploys onto this VPS. Convergence is purely VPS-level.

	logger.info(`Convergence complete for VPS "${input.vpsName}"`)
}
