import { buildOutputs } from './terraform-outputs.ts'
import {
	buildResourceBlock,
	buildZoneData,
	deriveWorkersResources,
} from './terraform-resources.ts'

import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { TerraformMainConfig } from './terraform-main-config.ts'

export type { TerraformMainConfig } from './terraform-main-config.ts'

// HCP Terraform organization every workspace lives under. Not a nextnode.toml
// default (it is not overridable per project) - it is the fixed backend
// coordinate the generated `terraform.cloud` block points at.
export const HCP_TERRAFORM_ORGANIZATION = 'nextnode'

// The Cloudflare provider is pinned to its major (v5). The generated config is
// the only place the provider version is materialised; a major bump is a
// deliberate, reviewed change - never a floating `>=`.
export const CLOUDFLARE_PROVIDER_SOURCE = 'cloudflare/cloudflare'
export const CLOUDFLARE_PROVIDER_VERSION = '~> 5.0'

/**
 * Transform a cloudflare-workers deployable config + environment into the
 * `main.tf.json` object Terraform consumes verbatim. Pure: no IO, no env reads.
 * The zone is always a `data` lookup (never a managed resource) and no
 * worker script / worker custom domain is emitted - those live on the wrangler
 * side of the ownership boundary.
 */
export function buildTerraformMainConfig(
	config: CloudflareWorkersDeployableConfig,
	environment: AppEnvironment,
): TerraformMainConfig {
	const derived = deriveWorkersResources(config, environment)

	const mainConfig: TerraformMainConfig = {
		terraform: {
			cloud: {
				organization: HCP_TERRAFORM_ORGANIZATION,
				workspaces: {
					name: `${derived.projectName}-${environment}`,
				},
			},
			required_providers: {
				cloudflare: {
					source: CLOUDFLARE_PROVIDER_SOURCE,
					version: CLOUDFLARE_PROVIDER_VERSION,
				},
			},
		},
		provider: { cloudflare: {} },
		data: { cloudflare_zone: buildZoneData(derived) },
		resource: buildResourceBlock(derived),
		output: buildOutputs(derived),
	}

	if (derived.hasAccountResource) {
		return { ...mainConfig, variable: { account_id: { type: 'string' } } }
	}
	return mainConfig
}
