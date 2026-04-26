import type {
	CloudflarePagesDeployableConfig,
	DeployableConfig,
	HetznerDeployableConfig,
} from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { DeployTarget } from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

import { TARGET_DEFINITIONS } from './registry.ts'

/**
 * Build a DeployTarget by looking up the definition in `TARGET_DEFINITIONS`
 * keyed on the config's `deploy.target` discriminator. Hetzner targets
 * need a verified infra storage runtime; Pages targets do not — the
 * preconditions live on each definition, not in this dispatcher.
 *
 * The overloads encode "Hetzner requires non-null infra storage, Pages
 * accepts null" so callers that have already narrowed the config get
 * compile-time enforcement; the union signature handles
 * still-unnarrowed callers (today's commands).
 */
export function buildRuntimeTarget(
	config: HetznerDeployableConfig,
	environment: AppEnvironment,
	infraStorage: InfraStorageRuntimeConfig,
): DeployTarget
export function buildRuntimeTarget(
	config: CloudflarePagesDeployableConfig,
	environment: AppEnvironment,
	infraStorage: InfraStorageRuntimeConfig | null,
): DeployTarget
export function buildRuntimeTarget(
	config: DeployableConfig,
	environment: AppEnvironment,
	infraStorage: InfraStorageRuntimeConfig | null,
): DeployTarget
export function buildRuntimeTarget(
	config: DeployableConfig,
	environment: AppEnvironment,
	infraStorage: InfraStorageRuntimeConfig | null,
): DeployTarget {
	const definition = TARGET_DEFINITIONS[config.deploy.target]
	const target = definition.build(config, { environment, infraStorage })
	if (!target) {
		throw new Error(
			`buildRuntimeTarget: definition "${definition.name}" returned null for matching config — definition bug`,
		)
	}
	return target
}
