import { writeSummary } from '#/adapters/github/output.ts'
import {
	getEnv,
	readJsonRecordEnv,
	requireEnv,
	requireGithubRepository,
} from '#/cli/env.ts'
import { resolveServices } from '#/cli/services/resolve.ts'
import { buildProvisionSummary } from '#/domain/deploy/provision-summary.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { mergeServiceEnvs } from '#/domain/services/service.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'
import { ensureGeneratedSecrets } from './ensure-generated-secrets.ts'
import { ensureInfraStorageForConfig } from './load-infra-storage.ts'

import type { DeployableConfig } from '#/config/types.ts'
import type { DeployTarget } from '#/domain/deploy/target.ts'

export async function provisionCommand(
	config: DeployableConfig,
): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const cfToken = requireEnv('CLOUDFLARE_API_TOKEN')
	const repository = requireGithubRepository()
	const repoSecrets = readJsonRecordEnv('ALL_SECRETS')

	const infraStorage = await ensureInfraStorageForConfig(config, cfToken)

	const target = buildRuntimeTarget(config, environment, infraStorage)
	const provisionResult = await target.ensureInfra(config.project.name)

	await verifyBackingEnv(target, config.project.name)

	const services = resolveServices({
		config,
		environment,
		repository,
		cfToken,
		infraStorage,
		repoSecrets,
	})
	await Promise.all(services.map(service => service.provision()))

	await ensureGeneratedSecrets(config.deploy.generatedSecrets, repoSecrets, {
		owner: repository.owner,
		repo: repository.name,
		environment,
	})

	writeSummary(
		buildProvisionSummary(
			provisionResult,
			config.project.name,
			target.name,
		),
	)
}

// For a target that maps backing infrastructure outside the CLI Service
// registry (cloudflare-workers, via Terraform outputs), read the freshly
// applied outputs and merge them with the target's own env right after
// provision. This proves the env contract the deploy step relies on -
// every declared backing resource emitted its output and no key collides -
// so a mapping error fails at provision, not mid-deploy. Targets without
// `loadBackingEnv` (Hetzner, Pages) contribute nothing to verify here.
async function verifyBackingEnv(
	target: DeployTarget,
	projectName: string,
): Promise<void> {
	if (!target.loadBackingEnv) return
	const backingEnv = await target.loadBackingEnv(projectName)
	mergeServiceEnvs([await target.contributeEnv(projectName), backingEnv])
}
