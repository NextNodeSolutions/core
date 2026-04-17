import { writeSummary } from '../../adapters/github/output.ts'
import type { DeployableConfig } from '../../config/types.ts'
import {
	isCloudflarePagesDeployableConfig,
	isHetznerDeployableConfig,
} from '../../config/types.ts'
import { buildProvisionSummary } from '../../domain/deploy/provision-summary.ts'
import type { DeployTarget } from '../../domain/deploy/target.ts'
import type { AppEnvironment } from '../../domain/environment.ts'
import { resolveEnvironment } from '../../domain/environment.ts'
import { getEnv, requireEnv } from '../env.ts'
import { ensureR2Setup } from '../r2/ensure-setup.ts'

import { createCloudflarePagesTarget } from './create-cloudflare-pages-target.ts'
import { createHetznerTarget } from './create-hetzner-target.ts'

async function buildProvisionTarget(
	config: DeployableConfig,
	environment: AppEnvironment,
): Promise<DeployTarget> {
	if (isHetznerDeployableConfig(config)) {
		const r2 = await ensureR2Setup(requireEnv('CLOUDFLARE_API_TOKEN'))
		return createHetznerTarget(config, environment, r2)
	}
	if (isCloudflarePagesDeployableConfig(config)) {
		return createCloudflarePagesTarget(config, environment)
	}
	throw new Error(
		'provisionCommand: unknown deploy target - config validation should have caught this',
	)
}

export async function provisionCommand(
	config: DeployableConfig,
): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const target = await buildProvisionTarget(config, environment)
	const result = await target.ensureInfra(config.project.name)

	writeSummary(
		buildProvisionSummary(result, config.project.name, target.name),
	)
}
