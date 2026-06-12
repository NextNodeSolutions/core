import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writeEnvVar, writeSecret } from '#/adapters/github/env.ts'
import { writeSummary } from '#/adapters/github/output.ts'
import { buildDeploySummary } from '#/domain/deploy/deploy-summary.ts'

import { resolveDeployContext } from './resolve-deploy-context.ts'

import type { DeployableConfig } from '#/config/types.ts'

export async function deployCommand(config: DeployableConfig): Promise<void> {
	const { target, env, input, merged } = await resolveDeployContext(config)

	for (const [key, value] of Object.entries(merged.public)) {
		writeEnvVar(key, value)
	}
	for (const [key, value] of Object.entries(merged.secret)) {
		writeSecret(key, value)
	}
	logger.info(
		`Wrote ${Object.keys(merged.public).length} public envs (${Object.keys(merged.public).join(', ')}) and ${Object.keys(merged.secret).length} masked secrets to GITHUB_ENV`,
	)

	const deployResult = await target.deploy(config.project.name, input, env)

	writeSummary(buildDeploySummary(deployResult, target.name))
	logger.info(
		`Deploy complete for "${deployResult.projectName}" in ${deployResult.durationMs}ms`,
	)
}
