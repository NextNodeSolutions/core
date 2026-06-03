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
	UserServiceConfig,
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
	const serviceEnvs = await Promise.all(
		services.map(async service => ({
			name: service.name,
			env: await service.loadEnv(),
		})),
	)
	const servicesEnv = mergeServiceEnvs(serviceEnvs.map(entry => entry.env))
	const secretOrigins = buildSecretOrigins(serviceEnvs)
	const userSecretsEnv: ServiceEnv = {
		public: {},
		secret: pickSecrets(repoSecrets, config.deploy.secrets),
	}
	const merged = mergeServiceEnvs([targetEnv, servicesEnv, userSecretsEnv])

	const env = buildDeployEnv(merged.public)
	const input = buildDeployInput(
		config,
		merged.secret,
		repoSecrets,
		secretOrigins,
	)

	return { target, env, input, environment, merged, repoSecrets }
}

// Map every backing service's secret keys back to the service that produced
// them (`DATABASE_URL` → `postgres`, `R2_ACCESS_KEY_ID` → `r2`). The container
// target uses this provenance to project each backing secret only to the
// services that declare `needs = [<producer>]`. Public env carries no
// provenance — only secrets are projected per service.
function buildSecretOrigins(
	serviceEnvs: ReadonlyArray<{ name: string; env: ServiceEnv }>,
): Record<string, string> {
	return Object.fromEntries(
		serviceEnvs.flatMap(({ name, env }) =>
			Object.keys(env.secret).map((key): [string, string] => [key, name]),
		),
	)
}

export function buildDeployInput(
	config: DeployableConfig,
	secrets: Readonly<Record<string, string>>,
	repoSecrets: Readonly<Record<string, string>>,
	secretOrigins: Readonly<Record<string, string>> = {},
): DeployInput {
	if (isHetznerDeployableConfig(config)) {
		return {
			secrets,
			secretOrigins,
			images: parseImageRefsEnv(requireEnv('IMAGE_REFS')),
			registryToken: resolveRegistryToken(config, repoSecrets),
		}
	}
	return { secrets, secretOrigins, registryToken: undefined }
}

// A deploy forwards exactly one registry token, and the services are
// homogeneous in source (mixed sources are rejected at validation). Any `build`
// service means every image lives on GHCR, authenticated with the GHCR token; an
// all-upstream deploy authenticates with the shared registry_auth_secret (or
// none, for public images).
function resolveRegistryToken(
	config: HetznerDeployableConfig,
	repoSecrets: Readonly<Record<string, string>>,
): string | undefined {
	const services = Object.values(config.deploy.services)
	if (services.some(service => service.source === 'build')) {
		return requireEnv('GHCR_TOKEN')
	}
	return resolveUpstreamRegistryToken(config.deploy.services, repoSecrets)
}

// Resolve the single registry token shared by every upstream service. Returns
// undefined when no service declares a registry_auth_secret (public images).
// Throws when services declare DIFFERENT auth secrets — a deploy forwards one
// token, so two private registries cannot both be authenticated.
function resolveUpstreamRegistryToken(
	services: Readonly<Record<string, UserServiceConfig>>,
	repoSecrets: Readonly<Record<string, string>>,
): string | undefined {
	const declaringBySecret = new Map<string, string>()
	for (const [name, service] of Object.entries(services)) {
		if (service.source !== 'upstream') continue
		const secret = service.registryAuthSecret
		if (secret === undefined) continue
		if (!declaringBySecret.has(secret)) declaringBySecret.set(secret, name)
	}

	if (declaringBySecret.size > 1) {
		throw new Error(
			`deploy.services declare multiple distinct registry_auth_secret values (${[...declaringBySecret.keys()].join(', ')}); a deploy forwards a single registry token — use one secret across services`,
		)
	}

	const entry = declaringBySecret.entries().next().value
	if (entry === undefined) return undefined

	const [secret, name] = entry
	const value = repoSecrets[secret]
	if (value === undefined) {
		throw new Error(
			`Secret "${secret}" declared in deploy.services.${name}.registry_auth_secret but not found in GitHub Secrets`,
		)
	}
	return value
}
