import { cloudflarePagesTargetDefinition } from './create-cloudflare-pages-target.ts'
import { cloudflareWorkersTargetDefinition } from './create-cloudflare-workers-target.ts'
import { hetznerTargetDefinition } from './create-hetzner-target.ts'

import type { DeployTargetType } from '#/config/types.ts'
import type { TargetDefinition } from './target.ts'

/**
 * Registry of every supported deploy target. The mapped-type `satisfies`
 * constraint enforces compile-time completeness against `DEPLOY_TARGETS`.
 */
export const TARGET_DEFINITIONS = {
	'hetzner-vps': hetznerTargetDefinition,
	'cloudflare-pages': cloudflarePagesTargetDefinition,
	'cloudflare-workers': cloudflareWorkersTargetDefinition,
} as const satisfies {
	readonly [K in DeployTargetType]: TargetDefinition<K>
}
