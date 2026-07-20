import { isCloudflareWorkersDeployableConfig } from '#/config/types.ts'

import type { TargetDefinition } from './target.ts'

export const cloudflareWorkersTargetDefinition: TargetDefinition<'cloudflare-workers'> =
	{
		name: 'cloudflare-workers',
		build(config) {
			if (!isCloudflareWorkersDeployableConfig(config)) return null
			throw new Error(
				'cloudflare-workers target: provisioning and deploy land with the Terraform/wrangler implementation - not wired yet',
			)
		},
	}
