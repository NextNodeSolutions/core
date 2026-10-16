import { requireEnv } from '#/cli/env.ts'
import { hasInternalWorker } from '#/domain/cloudflare/workers/internal-workers.ts'

import type { OrganizationConfig } from '#/config/organization.ts'
import type { DeployableConfig } from '#/config/types.ts'

export function resolveOrganization(
	config: DeployableConfig,
): OrganizationConfig {
	return {
		terraformOrganization: requireEnv('TF_CLOUD_ORGANIZATION'),
		...(config.services.planetscale && {
			planetscaleOrganization: requireEnv('PLANETSCALE_ORGANIZATION'),
		}),
		...(hasInternalWorker(config.deploy.services) && {
			access: {
				emailDomain: requireEnv('COMPANY_DOMAIN'),
				sessionDuration: requireEnv('ACCESS_SESSION_DURATION'),
				teamDomain: requireEnv('ACCESS_TEAM_DOMAIN'),
			},
		}),
	}
}
