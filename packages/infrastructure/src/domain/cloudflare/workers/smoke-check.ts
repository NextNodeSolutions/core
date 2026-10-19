import { computeSiteUrl } from '#/domain/deploy/domain.ts'

import type { DeployServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

export const HEALTHZ_PATH = '/healthz'

export interface SmokeCheckTarget {
	readonly service: string
	readonly url: string
}

/**
 * The `/healthz` URLs to smoke-check after deploy, one per public ROUTED
 * service (a service declaring a `url`). A service without `url` carries no
 * custom domain, and an internal one answers CI with an Access login, so both
 * are skipped. Each URL is env-resolved through `computeSiteUrl` (the same dev
 * subdomain convention the Custom Domain routes use), so the check hits the
 * exact hostname the deploy just wired.
 */
export function computeSmokeCheckUrls(
	services: Readonly<Record<string, DeployServiceConfig>>,
	environment: AppEnvironment,
): ReadonlyArray<SmokeCheckTarget> {
	const targets: Array<SmokeCheckTarget> = []
	for (const [service, config] of Object.entries(services)) {
		if (typeof config.url === 'undefined' || config.internal) continue
		targets.push({
			service,
			url: `${computeSiteUrl(config.url, environment)}${HEALTHZ_PATH}`,
		})
	}
	return targets
}
