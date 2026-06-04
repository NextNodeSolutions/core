import { resolveDeployDomain } from '#/domain/deploy/domain.ts'

import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * Subdomain under which every public R2 bucket is served, e.g.
 * `assets.cdn.example.com`. Grouping buckets under a dedicated `cdn.`
 * parent keeps them isolated from the apex and the app's own routes.
 */
const R2_CDN_SUBDOMAIN = 'cdn'

/**
 * Public hostname for a CDN-enabled bucket: `<alias>.cdn.<resolved-domain>`.
 * Reuses `resolveDeployDomain` so the dev subdomain convention (and thus
 * the dev/prod split) is shared with SITE_URL and the Pages custom domains.
 */
export function computeR2CustomDomainHostname(
	alias: string,
	domain: string,
	environment: AppEnvironment,
): string {
	return `${alias}.${R2_CDN_SUBDOMAIN}.${resolveDeployDomain(domain, environment)}`
}

export function computeR2PublicUrl(hostname: string): string {
	return `https://${hostname}`
}
