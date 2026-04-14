import type { DeployableConfig } from '../config/types.ts'
import { resolveEnvironment } from '../domain/environment.ts'

import { createTarget } from './create-target.ts'
import { getEnv } from './env.ts'

export async function provisionCommand(
	config: DeployableConfig,
): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const target = createTarget(config, environment)
	await target.ensureInfra(config.project.name)
}
