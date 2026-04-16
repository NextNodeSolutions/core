import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writeEnvVar } from '../../adapters/github/env.ts'
import type { DeployableConfig } from '../../config/types.ts'
import { isHetznerDeployableConfig } from '../../config/types.ts'
import { parseImageRef } from '../../domain/deploy/image-ref.ts'
import type { DeployInput } from '../../domain/deploy/target.ts'
import { resolveEnvironment } from '../../domain/environment.ts'
import { getEnv, requireEnv } from '../env.ts'

import { createTarget } from './create-target.ts'
import { parseAllSecrets, pickSecrets } from './secrets.ts'

export async function deployCommand(config: DeployableConfig): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const target = await createTarget(config, environment)

	const env = target.computeDeployEnv(config.project.name)
	for (const [key, value] of Object.entries(env)) {
		writeEnvVar(key, value)
		logger.info(`${key}=${value}`)
	}

	const input = buildDeployInput(config)
	const result = await target.deploy(config.project.name, input)

	logger.info(
		`Deploy complete for "${result.projectName}" in ${result.durationMs}ms`,
	)
}

function buildDeployInput(config: DeployableConfig): DeployInput {
	const secrets = loadSecrets(config.deploy.secrets)
	if (isHetznerDeployableConfig(config)) {
		return { secrets, image: parseImageRef(requireEnv('IMAGE_REF')) }
	}
	return { secrets }
}

function loadSecrets(declared: ReadonlyArray<string>): Record<string, string> {
	if (declared.length === 0) return {}
	const allSecrets = parseAllSecrets(requireEnv('ALL_SECRETS'))
	return pickSecrets(allSecrets, declared)
}
