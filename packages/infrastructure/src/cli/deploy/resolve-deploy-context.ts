import { getEnv, readJsonRecordEnv } from '#/cli/env.ts'
import { buildDeployEnv } from '#/domain/deploy/target.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { mergeServiceEnvs } from '#/domain/services/service.ts'

import { TARGET_DEFINITIONS } from './registry.ts'
import { pickSecrets } from './secrets.ts'

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
	readonly repoSecrets: Readonly<Record<string, string>>
}

export async function resolveDeployContext(
	config: DeployableConfig,
): Promise<DeployContext> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const repoSecrets = readJsonRecordEnv('ALL_SECRETS')
	const target = TARGET_DEFINITIONS[config.deploy.target].build(config, {
		environment,
	})
	const merged = mergeServiceEnvs([
		await target.contributeEnv(config.project.name),
		await target.loadBackingEnv(config.project.name),
		{ public: {}, secret: pickSecrets(repoSecrets, config.deploy.secrets) },
	])
	return {
		target,
		environment,
		repoSecrets,
		merged,
		env: buildDeployEnv(merged.public),
		input: { secrets: merged.secret, secretOrigins: {} },
	}
}
