import type { DeployableConfig } from '../../config/types.ts'
import {
	isCloudflarePagesDeployableConfig,
	isHetznerDeployableConfig,
} from '../../config/types.ts'
import type { DeployTarget } from '../../domain/deploy/target.ts'
import type { AppEnvironment } from '../../domain/environment.ts'
import { requireEnv } from '../env.ts'
import { loadR2Runtime } from '../r2/load-runtime.ts'

import { createCloudflarePagesTarget } from './create-cloudflare-pages-target.ts'
import { createHetznerTarget } from './create-hetzner-target.ts'

/**
 * Build a DeployTarget for a runtime operation (deploy, dns) that consumes
 * already-provisioned infrastructure. For Hetzner, loads R2 creds from env
 * and verifies them via SigV4 — fails loud on stale creds.
 *
 * This is deliberately NOT used by `provisionCommand`: provision needs the
 * full R2 bootstrap (bucket creation, token rotation, org-secret persistence)
 * that only `ensureR2Setup` provides.
 */
export async function buildRuntimeTarget(
	config: DeployableConfig,
	environment: AppEnvironment,
): Promise<DeployTarget> {
	if (isHetznerDeployableConfig(config)) {
		const r2 = await loadR2Runtime(requireEnv('CLOUDFLARE_API_TOKEN'))
		return createHetznerTarget(config, environment, r2)
	}
	if (isCloudflarePagesDeployableConfig(config)) {
		return createCloudflarePagesTarget(config, environment)
	}
	throw new Error(
		'buildRuntimeTarget: unknown deploy target — config validation should have caught this',
	)
}
