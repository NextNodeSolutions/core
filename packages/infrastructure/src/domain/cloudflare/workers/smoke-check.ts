import { computeSiteUrl } from '#/domain/deploy/domain.ts'

import type { WorkerServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

export const HEALTHZ_PATH = '/healthz'

export interface SmokeCheckTarget {
	readonly service: string
	readonly url: string
}

/**
 * The `/healthz` URLs to smoke-check after deploy, one per ROUTED service (a
 * service declaring a `url`). Internal services carry no custom domain, so they
 * are skipped. Each URL is env-resolved through `computeSiteUrl` (the same dev
 * subdomain convention the Custom Domain routes use), so the check hits the
 * exact hostname the deploy just wired.
 */
export function computeSmokeCheckUrls(
	services: Readonly<Record<string, WorkerServiceConfig>>,
	environment: AppEnvironment,
): ReadonlyArray<SmokeCheckTarget> {
	const targets: Array<SmokeCheckTarget> = []
	for (const [service, config] of Object.entries(services)) {
		if (typeof config.url === 'undefined') continue
		targets.push({
			service,
			url: `${computeSiteUrl(config.url, environment)}${HEALTHZ_PATH}`,
		})
	}
	return targets
}
