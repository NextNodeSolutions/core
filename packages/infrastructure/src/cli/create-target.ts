import { CloudflarePagesTarget } from '../adapters/cloudflare/target.ts'
import type { DeployableConfig } from '../config/types.ts'
import type { DeployTarget } from '../domain/deploy-target.ts'
import type { AppEnvironment } from '../domain/environment.ts'

import { requireEnv } from './env.ts'

export function createTarget(
	config: DeployableConfig,
	environment: AppEnvironment,
): DeployTarget {
	switch (config.deploy.target) {
		case 'cloudflare-pages':
			return new CloudflarePagesTarget({
				accountId: requireEnv('CLOUDFLARE_ACCOUNT_ID'),
				token: requireEnv('CLOUDFLARE_API_TOKEN'),
				environment,
				domain: config.project.domain,
				redirectDomains: config.project.redirectDomains,
			})
		case 'hetzner-vps':
			throw new Error('hetzner-vps deploy target is not yet implemented')
	}
}
