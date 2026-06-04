/**
 * Subdomain under which every public R2 bucket is served, e.g.
 * `assets.cdn.example.com`. Grouping buckets under a dedicated `cdn.`
 * parent keeps them isolated from the apex and the app's own routes.
 */
const R2_CDN_SUBDOMAIN = 'cdn'

/**
 * Public hostname for a CDN-enabled bucket: `<alias>.cdn.<resolved-domain>`.
 * `resolvedDomain` is the ALREADY env-resolved deploy domain (the output of
 * `resolveDeployDomain`, e.g. `dev.example.com` in development) — the caller
 * resolves it ONCE so the dev/prod split stays a single source of truth shared
 * with SITE_URL and the Pages custom domains. Re-resolving here would double the
 * `dev.` prefix.
 */
export function computeR2CustomDomainHostname(
	alias: string,
	resolvedDomain: string,
): string {
	return `${alias}.${R2_CDN_SUBDOMAIN}.${resolvedDomain}`
}

export function computeR2PublicUrl(hostname: string): string {
	return `https://${hostname}`
}
