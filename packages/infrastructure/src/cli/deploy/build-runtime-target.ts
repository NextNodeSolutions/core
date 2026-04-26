import { CloudflarePagesTarget } from '@/adapters/cloudflare/target.ts'
import type { DeployableConfig } from '@/config/types.ts'
import {
	isCloudflarePagesDeployableConfig,
	isHetznerDeployableConfig,
} from '@/config/types.ts'
import type { R2RuntimeConfig } from '@/domain/cloudflare/r2/runtime-config.ts'
import type { DeployTarget } from '@/domain/deploy/target.ts'
import type { AppEnvironment } from '@/domain/environment.ts'

import { createHetznerTarget } from './create-hetzner-target.ts'

/**
 * Builds a DeployTarget. Hetzner targets need a verified infra R2 runtime;
 * Pages targets do not. Callers pick the R2 entry point: `ensureR2Setup` for
 * provision (bootstraps buckets + tokens + org secrets), `loadR2Runtime` for
 * runtime ops (deploy, dns, teardown).
 */
export function buildRuntimeTarget(
	config: DeployableConfig,
	environment: AppEnvironment,
	infraR2: R2RuntimeConfig | null,
): DeployTarget {
	if (isHetznerDeployableConfig(config)) {
		if (!infraR2) {
			throw new Error(
				'buildRuntimeTarget: Hetzner target requires infra R2 — invariant broken',
			)
		}
		return createHetznerTarget(config, environment, infraR2)
	}
	if (isCloudflarePagesDeployableConfig(config)) {
		return new CloudflarePagesTarget({
			environment,
			domain: config.project.domain,
			redirectDomains: config.project.redirectDomains,
		})
	}
	throw new Error(
		'buildRuntimeTarget: unknown deploy target — config validation should have caught this',
	)
}
