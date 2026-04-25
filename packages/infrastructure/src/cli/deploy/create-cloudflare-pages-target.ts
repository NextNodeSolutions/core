import { CloudflarePagesTarget } from '@/adapters/cloudflare/target.ts'
import type { CloudflarePagesDeployableConfig } from '@/config/types.ts'
import type { AppEnvironment } from '@/domain/environment.ts'

/**
 * Pure factory for the Cloudflare Pages deploy target. CF Pages reads its
 * API token lazily inside the target at IO time, so this factory is fully
 * synchronous and takes no runtime-resolved deps.
 */
export function createCloudflarePagesTarget(
	config: CloudflarePagesDeployableConfig,
	environment: AppEnvironment,
): CloudflarePagesTarget {
	return new CloudflarePagesTarget({
		environment,
		domain: config.project.domain,
		redirectDomains: config.project.redirectDomains,
	})
}
