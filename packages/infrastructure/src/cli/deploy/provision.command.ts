import { writeSummary } from '#/adapters/github/output.ts'
import { getEnv, requireEnv, requireGithubRepository } from '#/cli/env.ts'
import { resolveServices } from '#/cli/services/resolve.ts'
import { buildProvisionSummary } from '#/domain/deploy/provision-summary.ts'
import { resolveEnvironment } from '#/domain/environment.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'
import { ensureInfraStorageForConfig } from './load-infra-storage.ts'
import { readRepoSecrets } from './secrets.ts'

import type { DeployableConfig } from '#/config/types.ts'

export async function provisionCommand(
	config: DeployableConfig,
): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const cfToken = requireEnv('CLOUDFLARE_API_TOKEN')
	const repository = requireGithubRepository()
	const repoSecrets = readRepoSecrets()

	const infraStorage = await ensureInfraStorageForConfig(config, cfToken)

	const target = buildRuntimeTarget(config, environment, infraStorage)
	const result = await target.ensureInfra(config.project.name)

	const services = resolveServices({
		config,
		environment,
		repository,
		cfToken,
		infraStorage,
		repoSecrets,
	})
	await Promise.all(services.map(service => service.provision()))

	writeSummary(
		buildProvisionSummary(result, config.project.name, target.name),
	)
}
