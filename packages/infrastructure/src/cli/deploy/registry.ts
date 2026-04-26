import type { DeployTargetType } from '#/config/types.ts'

import { cloudflarePagesTargetDefinition } from './create-cloudflare-pages-target.ts'
import { hetznerTargetDefinition } from './create-hetzner-target.ts'
import type { TargetDefinition } from './target.ts'

/**
 * The single registry of every supported deploy target. The mapped-type
 * `satisfies` constraint forces compile-time completeness: extending
 * `DEPLOY_TARGETS` in `config/types.ts` without registering a definition
 * here is a TypeScript error, not a silent no-op.
 *
 * Adding a target is exactly two diffs:
 *   1. Append the discriminator + config types to `DEPLOY_TARGETS` /
 *      `DeploySection` / `*DeployableConfig` in `config/types.ts`.
 *   2. Add `<discriminator>: <definition>` here.
 *
 * `buildRuntimeTarget` and every command call site stays untouched.
 */
export const TARGET_DEFINITIONS = {
	'hetzner-vps': hetznerTargetDefinition,
	'cloudflare-pages': cloudflarePagesTargetDefinition,
} as const satisfies {
	readonly [K in DeployTargetType]: TargetDefinition<K>
}
