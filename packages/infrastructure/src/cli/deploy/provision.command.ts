import { writeSummary } from '#/adapters/github/output.ts'
import { getEnv } from '#/cli/env.ts'
import { buildProvisionSummary } from '#/domain/deploy/provision-summary.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { mergeServiceEnvs } from '#/domain/services/service.ts'

import { TARGET_DEFINITIONS } from './registry.ts'

import type { DeployableConfig } from '#/config/types.ts'

export async function provisionCommand(
	config: DeployableConfig,
): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const target = TARGET_DEFINITIONS[config.deploy.target].build(config, {
		environment,
	})
	const provisioned = await target.ensureInfra(config.project.name)
	mergeServiceEnvs([
		await target.contributeEnv(config.project.name),
		await target.loadBackingEnv(config.project.name),
	])
	writeSummary(
		buildProvisionSummary(provisioned, config.project.name, target.name),
	)
}
