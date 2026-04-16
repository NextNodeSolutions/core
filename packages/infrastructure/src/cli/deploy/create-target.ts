import { CloudflarePagesTarget } from '../../adapters/cloudflare/target.ts'
import { derivePublicKey } from '../../adapters/hetzner/derive-public-key.ts'
import { HetznerVpsTarget } from '../../adapters/hetzner/target.ts'
import type { DeployableConfig } from '../../config/types.ts'
import {
	isCloudflarePagesDeployableConfig,
	isHetznerDeployableConfig,
} from '../../config/types.ts'
import type { DeployTarget } from '../../domain/deploy/target.ts'
import type { AppEnvironment } from '../../domain/environment.ts'
import { getEnv, requireB64Env, requireEnv } from '../env.ts'

import { ensureR2Setup } from './ensure-r2.ts'

export async function createTarget(
	config: DeployableConfig,
	environment: AppEnvironment,
): Promise<DeployTarget> {
	if (isHetznerDeployableConfig(config)) {
		const r2 = await ensureR2Setup(requireEnv('CLOUDFLARE_API_TOKEN'))
		const vlUrl = getEnv('NN_VL_URL')
		const deployPrivateKey = requireB64Env('DEPLOY_SSH_PRIVATE_KEY_B64')
		return new HetznerVpsTarget({
			hetzner: config.deploy.hetzner,
			r2,
			environment,
			domain: config.project.domain,
			credentials: {
				hcloudToken: requireEnv('HETZNER_API_TOKEN'),
				deployPrivateKey,
				deployPublicKey: derivePublicKey(deployPrivateKey),
				tailscaleAuthKey: requireEnv('TAILSCALE_AUTH_KEY'),
			},
			vector: vlUrl
				? { clientId: requireEnv('NN_CLIENT_ID'), vlUrl }
				: null,
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
