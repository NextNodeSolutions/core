import { createLogger } from '@nextnode-solutions/logger'

import type { SshSession } from '@/adapters/hetzner/ssh/session.types.ts'
import { shellEscape } from '@/adapters/hetzner/ssh/shell-escape.ts'

const logger = createLogger()

const VECTOR_TOML_PATH = '/etc/vector/vector.toml'
const VECTOR_ENV_PATH = '/etc/vector/vector.env'
const CADDY_CONFIG_PATH = '/etc/caddy/config.json'

export interface ConvergenceInput {
	readonly projectName: string
	readonly vectorToml: string | undefined
	readonly vectorEnv: string | undefined
	readonly caddyConfig: string
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
	// Vector config — skipped when log sink (NN_VL_URL) is unknown at provision time.
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

	// Project directories — deploy is the SSH user, so mkdir creates dirs
	// owned by deploy. No chown needed.
	const basePath = `/opt/apps/${input.projectName}`
	await session.exec(
		`mkdir -p ${shellEscape(`${basePath}/dev`)} ${shellEscape(`${basePath}/production`)}`,
	)

	logger.info(`Convergence complete for "${input.projectName}"`)
}
