import { CloudflareWorkersTarget } from '#/adapters/cloudflare/workers/target.ts'
import { requireEnv } from '#/cli/env.ts'
import { isCloudflareWorkersDeployableConfig } from '#/config/types.ts'

import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { TargetDefinition } from './target.ts'

export function createCloudflareWorkersTarget(
	config: CloudflareWorkersDeployableConfig,
	environment: AppEnvironment,
): CloudflareWorkersTarget {
	// The Terraform Cloudflare provider authenticates from the ambient
	// CLOUDFLARE_API_TOKEN (defaultTerraformRunner forwards process.env); require
	// it here so a missing token fails fast at factory time, not mid-apply.
	requireEnv('CLOUDFLARE_API_TOKEN')
	return new CloudflareWorkersTarget({
		accountId: requireEnv('CLOUDFLARE_ACCOUNT_ID'),
		hcpToken: requireEnv('TF_TOKEN_app_terraform_io'),
		environment,
		config,
	})
}

export const cloudflareWorkersTargetDefinition: TargetDefinition<'cloudflare-workers'> =
	{
		name: 'cloudflare-workers',
		build(config, ctx) {
			if (!isCloudflareWorkersDeployableConfig(config)) return null
			return createCloudflareWorkersTarget(config, ctx.environment)
		},
	}
