import { CloudflarePagesTarget } from '#/adapters/cloudflare/target.ts'
import { requireEnv } from '#/cli/env.ts'
import type { CloudflarePagesDeployableConfig } from '#/config/types.ts'
import { isCloudflarePagesDeployableConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

import type { TargetDefinition } from './target.ts'

export function createCloudflarePagesTarget(
	config: CloudflarePagesDeployableConfig,
	environment: AppEnvironment,
): CloudflarePagesTarget {
	return new CloudflarePagesTarget({
		accountId: requireEnv('CLOUDFLARE_ACCOUNT_ID'),
		token: requireEnv('CLOUDFLARE_API_TOKEN'),
		environment,
		domain: config.project.domain,
		redirectDomains: config.project.redirectDomains,
	})
}

export const cloudflarePagesTargetDefinition: TargetDefinition<'cloudflare-pages'> =
	{
		name: 'cloudflare-pages',
		build(config, ctx) {
			if (!isCloudflarePagesDeployableConfig(config)) return null
			return createCloudflarePagesTarget(config, ctx.environment)
		},
	}
