import { getEnv, isEnvSet, readJsonRecordEnv } from '#/cli/env.ts'
import { buildDeployEnv } from '#/domain/deploy/target.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { mergeServiceEnvs } from '#/domain/services/service.ts'

import { TARGET_DEFINITIONS } from './registry.ts'

import type { DeployableConfig } from '#/config/types.ts'
import type {
	DeployEnv,
	DeployInput,
	DeployTarget,
} from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'

export type DeployContext = {
	readonly target: DeployTarget
	readonly env: DeployEnv
	readonly input: DeployInput
	readonly environment: AppEnvironment
	readonly merged: ServiceEnv
}

// The repository's whole Infisical environment, as `load-secrets` emitted it.
// Unset when the repository has no Infisical project, and in jobs that only act
// on the infrastructure: then no Worker secret is touched.
function readProjectSecrets(): Readonly<Record<string, string>> | undefined {
	if (!isEnvSet('PROJECT_SECRETS')) return undefined
	return readJsonRecordEnv('PROJECT_SECRETS')
}

export interface DeployContextOptions {
	// Set by the deploy command: the target starts the work that needs no
	// input (the image push) while the backing env is read.
	readonly prepareDeploy?: boolean
}

export async function resolveDeployContext(
	config: DeployableConfig,
	options: DeployContextOptions = {},
): Promise<DeployContext> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const target = TARGET_DEFINITIONS[config.deploy.target].build(config, {
		environment,
	})
	if (options.prepareDeploy) target.prepareDeploy?.(config.project.name)
	const projectSecrets = readProjectSecrets()
	const merged = mergeServiceEnvs([
		await target.contributeEnv(config.project.name),
		await target.loadBackingEnv(config.project.name),
		{ public: {}, secret: projectSecrets ?? {} },
	])
	return {
		target,
		environment,
		merged,
		env: buildDeployEnv(merged.public),
		input: {
			secrets: projectSecrets ? merged.secret : undefined,
		},
	}
}
