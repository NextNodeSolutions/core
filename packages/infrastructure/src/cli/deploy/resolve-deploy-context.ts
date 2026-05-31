import { getEnv, requireEnv, requireGithubRepository } from '#/cli/env.ts'
import { resolveServices } from '#/cli/services/resolve.ts'
import { isHetznerDeployableConfig } from '#/config/types.ts'
import { parseImageRefsEnv } from '#/domain/deploy/image-ref.ts'
import { buildDeployEnv } from '#/domain/deploy/target.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { mergeServiceEnvs } from '#/domain/services/service.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'
import { loadInfraStorageForConfig } from './load-infra-storage.ts'
import { pickSecrets, readRepoSecrets } from './secrets.ts'

import type {
	DeployableConfig,
	HetznerDeployableConfig,
} from '#/config/types.ts'
import type {
	DeployEnv,
	DeployInput,
	DeployTarget,
} from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'

/**
 * Everything a rollout CLI command needs from the environment to drive
 * a `DeployTarget`: the resolved target, the merged env (public +
 * secret) split into the public `DeployEnv` and a `DeployInput`, the
 * resolved environment name, and the raw `ALL_SECRETS` map so the
 * caller can write masked vars to `GITHUB_ENV`.
 */
export interface DeployContext {
	readonly target: DeployTarget
	readonly env: DeployEnv
	readonly input: DeployInput
	readonly environment: AppEnvironment
	readonly merged: ServiceEnv
	readonly repoSecrets: Readonly<Record<string, string>>
}

/**
 * Resolve everything a rollout command (`deploy`, `migrate-remote`)
 * needs from the environment. Single source of truth for env merging:
 * target → services → user-declared secrets, in that precedence. Both
 * commands share the exact same resolution so the env file written by
 * one is byte-identical to what the other would write.
 */
export async function resolveDeployContext(
	config: DeployableConfig,
): Promise<DeployContext> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const cfToken = requireEnv('CLOUDFLARE_API_TOKEN')
	const repository = requireGithubRepository()
	const repoSecrets = readRepoSecrets()

	const infraStorage = await loadInfraStorageForConfig(config)
	const target = buildRuntimeTarget(config, environment, infraStorage)

	const services = resolveServices({
		config,
		environment,
		repository,
		cfToken,
		infraStorage,
		repoSecrets,
	})

	const targetEnv = await target.contributeEnv(config.project.name)
	const servicesEnv = mergeServiceEnvs(
		await Promise.all(services.map(service => service.loadEnv())),
	)
	const userSecretsEnv: ServiceEnv = {
		public: {},
		secret: pickSecrets(repoSecrets, config.deploy.secrets),
	}
	const merged = mergeServiceEnvs([targetEnv, servicesEnv, userSecretsEnv])

	const env = buildDeployEnv(merged.public)
	const input = buildDeployInput(config, merged.secret, repoSecrets)

	return { target, env, input, environment, merged, repoSecrets }
}

export function buildDeployInput(
	config: DeployableConfig,
	secrets: Readonly<Record<string, string>>,
	repoSecrets: Readonly<Record<string, string>>,
): DeployInput {
	if (isHetznerDeployableConfig(config)) {
		return {
			secrets,
			images: parseImageRefsEnv(requireEnv('IMAGE_REFS')),
			registryToken: resolveRegistryToken(config, repoSecrets),
		}
	}
	return { secrets, registryToken: undefined }
}

function resolveRegistryToken(
	config: HetznerDeployableConfig,
	repoSecrets: Readonly<Record<string, string>>,
): string | undefined {
	const image = config.deploy.image
	if (image.source === 'build') return requireEnv('GHCR_TOKEN')
	if (image.registryAuthSecret === undefined) return undefined
	const value = repoSecrets[image.registryAuthSecret]
	if (value === undefined) {
		throw new Error(
			`Secret "${image.registryAuthSecret}" declared in deploy.image.registry_auth_secret but not found in GitHub Secrets`,
		)
	}
	return value
}
