import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { writeEnvVar, writeSecret } from '#/adapters/github/env.ts'
import { writeSummary } from '#/adapters/github/output.ts'
import { getEnv, requireEnv } from '#/cli/env.ts'
import { resolveServices } from '#/cli/services/resolve.ts'
import type {
	DeployableConfig,
	HetznerDeployableConfig,
} from '#/config/types.ts'
import { isHetznerDeployableConfig } from '#/config/types.ts'
import { buildDeploySummary } from '#/domain/deploy/deploy-summary.ts'
import { parseImageRef } from '#/domain/deploy/image-ref.ts'
import type { DeployInput } from '#/domain/deploy/target.ts'
import { buildDeployEnv } from '#/domain/deploy/target.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'
import { mergeServiceEnvs } from '#/domain/services/service.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'
import { loadInfraStorageForConfig } from './load-infra-storage.ts'
import { parseAllSecrets, pickSecrets } from './secrets.ts'

export async function deployCommand(config: DeployableConfig): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const cfToken = requireEnv('CLOUDFLARE_API_TOKEN')

	const infraStorage = await loadInfraStorageForConfig(config)
	const target = buildRuntimeTarget(config, environment, infraStorage)

	const services = resolveServices({
		config,
		environment,
		cfToken,
		infraStorage,
	})

	const targetEnv = await target.contributeEnv(config.project.name)
	const servicesEnv = mergeServiceEnvs(
		await Promise.all(services.map(service => service.loadEnv())),
	)
	const userSecretsEnv: ServiceEnv = {
		public: {},
		secret: loadDeclaredSecrets(config.deploy.secrets),
	}
	const merged = mergeServiceEnvs([targetEnv, servicesEnv, userSecretsEnv])

	for (const [key, value] of Object.entries(merged.public)) {
		writeEnvVar(key, value)
	}
	for (const [key, value] of Object.entries(merged.secret)) {
		writeSecret(key, value)
	}
	logger.info(
		`Wrote ${Object.keys(merged.public).length} public envs (${Object.keys(merged.public).join(', ')}) and ${Object.keys(merged.secret).length} masked secrets to GITHUB_ENV`,
	)

	const env = buildDeployEnv(merged.public)
	const input = buildDeployInput(config, merged.secret)
	const result = await target.deploy(config.project.name, input, env)

	writeSummary(buildDeploySummary(result, target.name))
	logger.info(
		`Deploy complete for "${result.projectName}" in ${result.durationMs}ms`,
	)
}

function buildDeployInput(
	config: DeployableConfig,
	secrets: Readonly<Record<string, string>>,
): DeployInput {
	if (isHetznerDeployableConfig(config)) {
		return {
			secrets,
			image: parseImageRef(requireEnv('IMAGE_REF')),
			registryToken: resolveRegistryToken(config),
		}
	}
	return { secrets, registryToken: undefined }
}

function resolveRegistryToken(
	config: HetznerDeployableConfig,
): string | undefined {
	const image = config.deploy.image
	if (image.source === 'build') return requireEnv('GHCR_TOKEN')
	if (image.registryAuthSecret === undefined) return undefined
	const allSecrets = parseAllSecrets(requireEnv('ALL_SECRETS'))
	const value = allSecrets[image.registryAuthSecret]
	if (value === undefined) {
		throw new Error(
			`Secret "${image.registryAuthSecret}" declared in deploy.image.registry_auth_secret but not found in GitHub Secrets`,
		)
	}
	return value
}

function loadDeclaredSecrets(
	declared: ReadonlyArray<string>,
): Record<string, string> {
	if (declared.length === 0) return {}
	const allSecrets = parseAllSecrets(requireEnv('ALL_SECRETS'))
	return pickSecrets(allSecrets, declared)
}
