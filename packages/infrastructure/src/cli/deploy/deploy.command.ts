import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writeEnvVar } from '#/adapters/github/env.ts'
import { writeSummary } from '#/adapters/github/output.ts'
import { buildDeploySummary } from '#/domain/deploy/deploy-summary.ts'

import { resolveDeployContext } from './resolve-deploy-context.ts'

import type { DeployableConfig } from '#/config/types.ts'

export async function deployCommand(config: DeployableConfig): Promise<void> {
	const { target, env, input, merged } = await resolveDeployContext(config)

	// Only the public values reach GITHUB_ENV: the secrets go to the Workers
	// through `wrangler secret bulk` and nowhere else.
	for (const [key, value] of Object.entries(merged.public)) {
		writeEnvVar(key, value)
	}
	logger.info(
		`Wrote ${Object.keys(merged.public).length} public envs (${Object.keys(merged.public).join(', ')}) to GITHUB_ENV`,
	)

	const deployResult = await target.deploy(config.project.name, input, env)

	writeSummary(buildDeploySummary(deployResult, target.name))
	logger.info(
		`Deploy complete for "${deployResult.projectName}" in ${deployResult.durationMs}ms`,
	)
}
