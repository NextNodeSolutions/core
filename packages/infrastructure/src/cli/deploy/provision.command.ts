import { writeSummary } from '@/adapters/github/output.ts'
import { getEnv, requireEnv } from '@/cli/env.ts'
import { resolveServices } from '@/cli/services/resolve.ts'
import type { DeployableConfig } from '@/config/types.ts'
import { buildProvisionSummary } from '@/domain/deploy/provision-summary.ts'
import { resolveEnvironment } from '@/domain/environment.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'
import { ensureInfraStorageForConfig } from './load-infra-storage.ts'

export async function provisionCommand(
	config: DeployableConfig,
): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const cfToken = requireEnv('CLOUDFLARE_API_TOKEN')

	const infraStorage = await ensureInfraStorageForConfig(config, cfToken)

	const target = buildRuntimeTarget(config, environment, infraStorage)
	const result = await target.ensureInfra(config.project.name)

	const services = resolveServices({
		config,
		environment,
		cfToken,
		infraStorage,
	})
	await Promise.all(services.map(service => service.provision()))

	writeSummary(
		buildProvisionSummary(result, config.project.name, target.name),
	)
}
