import { buildAccessResources } from './terraform-access.ts'

import type { OrganizationConfig } from '#/config/organization.ts'
import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { TerraformResourceBlock } from './terraform-main-config.ts'

export function buildInternalResources(
	config: CloudflareWorkersDeployableConfig,
	environment: AppEnvironment,
	organization: OrganizationConfig,
): TerraformResourceBlock {
	if (!config.project.internal) return {}
	const access = buildAccessResources(
		config,
		environment,
		organization.access,
	)
	return {
		cloudflare_zero_trust_access_application: access.applications,
		cloudflare_zero_trust_access_policy: access.policies,
	}
}
