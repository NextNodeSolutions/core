import { CloudflarePagesTarget } from '../../adapters/cloudflare/target.ts'
import { HetznerVpsTarget } from '../../adapters/hetzner/target.ts'
import type { DeployableConfig } from '../../config/types.ts'
import {
	isCloudflarePagesDeployableConfig,
	isHetznerDeployableConfig,
} from '../../config/types.ts'
import type { DeployTarget } from '../../domain/deploy/target.ts'
import type { AppEnvironment } from '../../domain/environment.ts'
import { requireEnv } from '../env.ts'

import { ensureR2Setup } from './ensure-r2.ts'

export async function createTarget(
	config: DeployableConfig,
	environment: AppEnvironment,
): Promise<DeployTarget> {
	if (isHetznerDeployableConfig(config)) {
		const r2 = await ensureR2Setup(requireEnv('CLOUDFLARE_API_TOKEN'))
		return new HetznerVpsTarget({
			hetzner: config.deploy.hetzner,
			r2,
			environment,
			domain: config.project.domain,
		})
	}

	if (isCloudflarePagesDeployableConfig(config)) {
		return new CloudflarePagesTarget({
			environment,
			domain: config.project.domain,
			redirectDomains: config.project.redirectDomains,
		})
	}

	throw new Error(
		`Unknown deploy target in config — validation should have caught this`,
	)
}
