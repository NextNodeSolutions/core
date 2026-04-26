import type { DeployableConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { DeployTarget } from '#/domain/deploy/target.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

import { TARGET_DEFINITIONS } from './registry.ts'

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
