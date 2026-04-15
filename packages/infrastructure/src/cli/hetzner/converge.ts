import { createLogger } from '@nextnode-solutions/logger'

import type { SshSession } from '../../adapters/hetzner/ssh-session.types.ts'

const logger = createLogger()

const VECTOR_TOML_PATH = '/etc/vector/vector.toml'
const VECTOR_ENV_PATH = '/etc/vector/vector.env'
const CADDY_CONFIG_PATH = '/etc/caddy/config.json'

export interface ConvergenceInput {
	readonly projectName: string
	readonly vectorToml: string
	readonly vectorEnv: string
	readonly caddyBaseConfig: string
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
	// Vector config
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
		await session.exec('systemctl restart vector')
		logger.info('Restarted vector')
	}

	// Caddy base config
	const caddyChanged = await pushFileIfChanged(
		session,
		CADDY_CONFIG_PATH,
		input.caddyBaseConfig,
	)

	if (caddyChanged) {
		await session.exec('systemctl restart caddy')
		logger.info('Restarted caddy')
	}

	// Project directories
	const basePath = `/opt/apps/${input.projectName}`
	await session.exec(`mkdir -p ${basePath}/dev ${basePath}/production`)
	await session.exec(`chown -R deploy:deploy ${basePath}`)

	logger.info(`Convergence complete for "${input.projectName}"`)
}
