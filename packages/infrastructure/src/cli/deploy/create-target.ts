import { CloudflarePagesTarget } from '../../adapters/cloudflare/target.ts'
import { HetznerVpsTarget } from '../../adapters/hetzner/target.ts'
import type { DeployableConfig } from '../../config/types.ts'
import type { DeployTarget } from '../../domain/deploy/target.ts'
import type { AppEnvironment } from '../../domain/environment.ts'

export function createTarget(
	config: DeployableConfig,
	environment: AppEnvironment,
): DeployTarget {
	switch (config.deploy.target) {
		case 'cloudflare-pages':
			return new CloudflarePagesTarget({
				environment,
				domain: config.project.domain,
				redirectDomains: config.project.redirectDomains,
			})
		case 'hetzner-vps':
			return new HetznerVpsTarget(config.deploy.hetzner)
	}
}
