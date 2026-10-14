import { writeSummary } from '#/adapters/github/output.ts'
import {
	getEnv,
	readJsonRecordEnv,
	requireGithubRepository,
} from '#/cli/env.ts'
import { buildProvisionSummary } from '#/domain/deploy/provision-summary.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { mergeServiceEnvs } from '#/domain/services/service.ts'

import { ensureGeneratedSecrets } from './ensure-generated-secrets.ts'
import { TARGET_DEFINITIONS } from './registry.ts'

import type { DeployableConfig } from '#/config/types.ts'

export async function provisionCommand(
	config: DeployableConfig,
): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const repository = requireGithubRepository()
	const repoSecrets = readJsonRecordEnv('ALL_SECRETS')
	const target = TARGET_DEFINITIONS[config.deploy.target].build(config, {
		environment,
	})
	const provisioned = await target.ensureInfra(config.project.name)
	mergeServiceEnvs([
		await target.contributeEnv(config.project.name),
		await target.loadBackingEnv(config.project.name),
	])
	await ensureGeneratedSecrets(config.deploy.generatedSecrets, repoSecrets, {
		repo: repository.name,
		environment,
	})
	writeSummary(
		buildProvisionSummary(provisioned, config.project.name, target.name),
	)
}
