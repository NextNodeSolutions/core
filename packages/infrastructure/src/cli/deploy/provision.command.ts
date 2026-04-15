import type { DeployableConfig } from '../../config/types.ts'
import { resolveEnvironment } from '../../domain/environment.ts'
import { getEnv } from '../env.ts'

import { createTarget } from './create-target.ts'

export async function provisionCommand(
	config: DeployableConfig,
): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)

	const target = await createTarget(config, environment)
	await target.ensureInfra(config.project.name)
}
