import { writeSummary } from '../../adapters/github/output.ts'
import type { DeployableConfig } from '../../config/types.ts'
import { buildTeardownSummary } from '../../domain/deploy/teardown-summary.ts'
import { resolveEnvironment } from '../../domain/environment.ts'
import { getEnv } from '../env.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'

export async function teardownCommand(config: DeployableConfig): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const target = await buildRuntimeTarget(config, environment)
	const result = await target.teardown(
		config.project.name,
		config.project.domain,
	)

	writeSummary(buildTeardownSummary(result, config.project.name, target.name))
}
