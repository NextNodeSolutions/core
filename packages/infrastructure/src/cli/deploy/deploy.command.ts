import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writeSummary } from '#/adapters/github/output.ts'
import { buildDeploySummary } from '#/domain/deploy/deploy-summary.ts'

import { resolveDeployContext } from './resolve-deploy-context.ts'

import type { DeployableConfig } from '#/config/types.ts'

export async function deployCommand(config: DeployableConfig): Promise<void> {
	const { target, input } = await resolveDeployContext(config)

	const deployResult = await target.deploy(config.project.name, input)

	writeSummary(buildDeploySummary(deployResult, target.name))
	logger.info(
		`Deploy complete for "${deployResult.projectName}" in ${deployResult.durationMs}ms`,
	)
}
