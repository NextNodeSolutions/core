import { cloudflareWorkersTargetDefinition } from './create-cloudflare-workers-target.ts'

import type { DeployTargetType } from '#/config/types.ts'
import type { TargetDefinition } from './target.ts'

export const TARGET_DEFINITIONS = {
	'cloudflare-workers': cloudflareWorkersTargetDefinition,
} satisfies { readonly [K in DeployTargetType]: TargetDefinition<K> }
