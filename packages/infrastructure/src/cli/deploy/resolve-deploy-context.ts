import { getEnv, isEnvSet, readJsonRecordEnv } from '#/cli/env.ts'
import { resolveEnvironment } from '#/domain/environment.ts'

import { TARGET_DEFINITIONS } from './registry.ts'

import type { DeployableConfig } from '#/config/types.ts'
import type { DeployInput, DeployTarget } from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

export type DeployContext = {
	readonly target: DeployTarget
	readonly input: DeployInput
	readonly environment: AppEnvironment
}

// The repository's whole Infisical environment, as `load-secrets` emitted it.
// Unset when the repository has no Infisical project, and in jobs that only act
// on the infrastructure: then no Worker secret is touched.
function readProjectSecrets(): Readonly<Record<string, string>> | undefined {
	if (!isEnvSet('PROJECT_SECRETS')) return undefined
	return readJsonRecordEnv('PROJECT_SECRETS')
}

export async function resolveDeployContext(
	config: DeployableConfig,
): Promise<DeployContext> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const target = TARGET_DEFINITIONS[config.deploy.target].build(config, {
		environment,
	})
	return {
		target,
		environment,
		input: { secrets: readProjectSecrets() },
	}
}
