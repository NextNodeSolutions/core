import {
	getEnv,
	readJsonRecordEnv,
	requireEnv,
	requireGithubRepository,
} from '#/cli/env.ts'
import { resolveServices } from '#/cli/services/resolve.ts'
import { isHetznerDeployableConfig } from '#/config/types.ts'
import { parseImageRefsEnv } from '#/domain/deploy/image-ref.ts'
import { buildDeployEnv } from '#/domain/deploy/target.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { mergeServiceEnvs } from '#/domain/services/service.ts'

import { buildRuntimeTarget } from './build-runtime-target.ts'
import { loadInfraStorageForConfig } from './load-infra-storage.ts'
import { pickSecrets } from './secrets.ts'

import type { GithubRepository } from '#/cli/env.ts'
import type {
	DeployableConfig,
	HetznerDeployableConfig,
	UserServiceConfig,
} from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
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
	// R2 runtime config (state + certs + S3 creds) when the config needs it;
	// `null` for static targets with no infra storage. Surfaced so rollout
	// commands can list the project's backup bucket (auto-restore) without
	// re-resolving the Cloudflare account id + re-verifying creds.
	readonly infraStorage: InfraStorageRuntimeConfig | null
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
	const repoSecrets = readJsonRecordEnv('ALL_SECRETS')

	const infraStorage = await loadInfraStorageForConfig(config)
	const target = buildRuntimeTarget(config, environment, infraStorage)

	const { merged, secretOrigins } = await resolveMergedDeployEnv({
		config,
		environment,
		repository,
		cfToken,
		infraStorage,
		repoSecrets,
		target,
	})

	const env = buildDeployEnv(merged.public)
	const input = buildDeployInput(
		config,
		merged.secret,
		repoSecrets,
		secretOrigins,
	)

	return {
		target,
		env,
		input,
		environment,
		merged,
		repoSecrets,
		infraStorage,
	}
}

interface MergedDeployEnvInput {
	readonly config: DeployableConfig
	readonly environment: AppEnvironment
	readonly repository: GithubRepository
	readonly cfToken: string
	readonly infraStorage: InfraStorageRuntimeConfig | null
	readonly repoSecrets: Readonly<Record<string, string>>
	readonly target: DeployTarget
}

// Resolve every service, load its env, and merge target + services + user
// secrets into a single ServiceEnv (with the per-secret provenance map).
// Extracted from resolveDeployContext to keep that orchestrator small.
async function resolveMergedDeployEnv(
	args: MergedDeployEnvInput,
): Promise<{ merged: ServiceEnv; secretOrigins: Record<string, string> }> {
	const services = resolveServices({
		config: args.config,
		environment: args.environment,
		repository: args.repository,
		cfToken: args.cfToken,
		infraStorage: args.infraStorage,
		repoSecrets: args.repoSecrets,
	})

	const targetEnv = await args.target.contributeEnv(args.config.project.name)
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
		secret: pickSecrets(args.repoSecrets, args.config.deploy.secrets),
	}
	// A target whose backing services are realised outside the CLI Service
	// registry (cloudflare-workers, via Terraform outputs) contributes its
	// backing env through `loadBackingEnv`. It merges alongside target +
	// services + user secrets so it obeys the same collision detection.
	const backingEnv = args.target.loadBackingEnv
		? await args.target.loadBackingEnv(args.config.project.name)
		: undefined
	const merged = mergeServiceEnvs([
		targetEnv,
		...(backingEnv ? [backingEnv] : []),
		servicesEnv,
		userSecretsEnv,
	])
	return { merged, secretOrigins }
}

// Map every backing service's secret keys back to the service that produced
// them (`DATABASE_URL` → `postgres`, `R2_ACCESS_KEY_ID` → `r2`). The container
// target uses this provenance to project each backing secret only to the
// services that declare `needs = [<producer>]`. Public env carries no
// provenance - only secrets are projected per service.
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
// Throws when services declare DIFFERENT auth secrets - a deploy forwards one
// token, so two private registries cannot both be authenticated.
function resolveUpstreamRegistryToken(
	services: Readonly<Record<string, UserServiceConfig>>,
	repoSecrets: Readonly<Record<string, string>>,
): string | undefined {
	const declaringBySecret = new Map<string, string>()
	for (const [name, service] of Object.entries(services)) {
		if (service.source !== 'upstream') continue
		const secret = service.registryAuthSecret
		if (typeof secret === 'undefined') continue
		if (!declaringBySecret.has(secret)) declaringBySecret.set(secret, name)
	}

	if (declaringBySecret.size > 1) {
		throw new Error(
			`deploy.services declare multiple distinct registry_auth_secret values (${[...declaringBySecret.keys()].join(', ')}); a deploy forwards a single registry token - use one secret across services`,
		)
	}

	const entry = declaringBySecret.entries().next().value
	if (!entry) return undefined

	const [secret, name] = entry
	const secretValue = repoSecrets[secret]
	if (typeof secretValue === 'undefined') {
		throw new Error(
			`Secret "${secret}" declared in deploy.services.${name}.registry_auth_secret but not found in GitHub Secrets`,
		)
	}
	return secretValue
}
