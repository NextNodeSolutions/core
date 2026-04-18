import { derivePublicKey } from '../../adapters/hetzner/ssh/derive-public-key.ts'
import { HetznerVpsTarget } from '../../adapters/hetzner/target.ts'
import type { HetznerDeployableConfig } from '../../config/types.ts'
import type { R2RuntimeConfig } from '../../domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '../../domain/environment.ts'
import { getEnv, requireB64Env, requireEnv } from '../env.ts'

const ACME_EMAIL = 'infra@nextnode.fr'

/**
 * Pure factory for the Hetzner VPS deploy target. Takes the already-resolved
 * R2 runtime config - callers pick bootstrap (`ensureR2Setup`, provision) or
 * runtime-load (`loadR2Runtime`, deploy) before calling this.
 */
export function createHetznerTarget(
	config: HetznerDeployableConfig,
	environment: AppEnvironment,
	r2: R2RuntimeConfig,
): HetznerVpsTarget {
	const vlUrl = getEnv('NN_VL_URL')
	const deployPrivateKey = requireB64Env('DEPLOY_SSH_PRIVATE_KEY_B64')
	return new HetznerVpsTarget({
		hetzner: config.deploy.hetzner,
		r2,
		environment,
		domain: config.project.domain,
		internal: config.project.internal,
		credentials: {
			hcloudToken: requireEnv('HETZNER_API_TOKEN'),
			deployPrivateKey,
			deployPublicKey: derivePublicKey(deployPrivateKey),
			tailscaleAuthKey: requireEnv('TAILSCALE_AUTH_KEY'),
		},
		vector: vlUrl ? { clientId: requireEnv('NN_CLIENT_ID'), vlUrl } : null,
		cloudflareApiToken: requireEnv('CLOUDFLARE_API_TOKEN'),
		acmeEmail: ACME_EMAIL,
	})
}
