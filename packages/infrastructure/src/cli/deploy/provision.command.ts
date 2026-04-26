import { writeMaskedOutput, writeSummary } from '#/adapters/github/output.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'
import { resolveServices } from '#/cli/services/resolve.ts'
import type { DeployableConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import { buildProvisionSummary } from '#/domain/deploy/provision-summary.ts'
import { resolveEnvironment } from '#/domain/environment.ts'

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
	publishInfraStorageOutputs(infraStorage)

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

function publishInfraStorageOutputs(
	infraStorage: InfraStorageRuntimeConfig | null,
): void {
	if (!infraStorage) return
	writeMaskedOutput('r2_access_key_id', infraStorage.accessKeyId)
	writeMaskedOutput('r2_secret_access_key', infraStorage.secretAccessKey)
}
