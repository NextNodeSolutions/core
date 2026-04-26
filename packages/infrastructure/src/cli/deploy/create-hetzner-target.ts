import { deleteDnsRecordsByName } from '#/adapters/cloudflare/dns/delete-records.ts'
import { reconcileDnsRecords } from '#/adapters/cloudflare/dns/reconcile.ts'
import { derivePublicKey } from '#/adapters/hetzner/ssh/derive-public-key.ts'
import { HetznerVpsTarget } from '#/adapters/hetzner/target.ts'
import { R2Client } from '#/adapters/r2/client.ts'
import { createTailnetClient } from '#/adapters/tailscale/oauth.ts'
import { getEnv, requireB64Env, requireEnv } from '#/cli/env.ts'
import type { HetznerDeployableConfig } from '#/config/types.ts'
import { isHetznerDeployableConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { DnsClient } from '#/domain/dns/client.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

import type { TargetDefinition } from './target.ts'

const ACME_EMAIL = 'infra@nextnode.fr'

/**
 * Pure factory for the Hetzner VPS deploy target. Reads env-derived
 * credentials and bridges the Cloudflare DNS adapter into a
 * provider-agnostic `DnsClient` so the Hetzner adapter never imports
 * across to Cloudflare.
 */
export function createHetznerTarget(
	config: HetznerDeployableConfig,
	environment: AppEnvironment,
	infraStorage: InfraStorageRuntimeConfig,
): HetznerVpsTarget {
	const vlUrl = getEnv('NN_VL_URL')
	const deployPrivateKey = requireB64Env('DEPLOY_SSH_PRIVATE_KEY_B64')
	const cloudflareApiToken = requireEnv('CLOUDFLARE_API_TOKEN')
	const dns: DnsClient = {
		reconcile: records => reconcileDnsRecords(records, cloudflareApiToken),
		deleteByName: lookups =>
			deleteDnsRecordsByName(lookups, cloudflareApiToken),
	}
	return new HetznerVpsTarget({
		hetzner: config.deploy.hetzner,
		infraStorage,
		stateStore: new R2Client({
			endpoint: infraStorage.endpoint,
			accessKeyId: infraStorage.accessKeyId,
			secretAccessKey: infraStorage.secretAccessKey,
			bucket: infraStorage.stateBucket,
		}),
		certsStore: new R2Client({
			endpoint: infraStorage.endpoint,
			accessKeyId: infraStorage.accessKeyId,
			secretAccessKey: infraStorage.secretAccessKey,
			bucket: infraStorage.certsBucket,
		}),
		environment,
		domain: config.project.domain,
		internal: config.project.internal,
		credentials: {
			hcloudToken: requireEnv('HETZNER_API_TOKEN'),
			deployPrivateKey,
			deployPublicKey: derivePublicKey(deployPrivateKey),
			tailnet: createTailnetClient(requireEnv('TAILSCALE_AUTH_KEY')),
		},
		vector: vlUrl ? { clientId: requireEnv('NN_CLIENT_ID'), vlUrl } : null,
		dns,
		cloudflareApiToken,
		acmeEmail: ACME_EMAIL,
	})
}

export const hetznerTargetDefinition: TargetDefinition<'hetzner-vps'> = {
	name: 'hetzner-vps',
	build(config, ctx) {
		if (!isHetznerDeployableConfig(config)) return null
		if (!ctx.infraStorage) {
			throw new Error(
				'hetzner-vps target: infra storage (state + certs buckets) must be loaded by the caller — caller invariant broken',
			)
		}
		return createHetznerTarget(config, ctx.environment, ctx.infraStorage)
	},
}
