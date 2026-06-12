import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * Resolve the actual domain for a given environment.
 *
 * - Production:  `{domain}` as-is
 * - Development: `dev.{domain}`
 *
 * This is the single source of truth for the dev subdomain convention.
 * Used by DNS records, Pages custom domains, and deploy env (SITE_URL).
 */
export function resolveDeployDomain(
	domain: string,
	environment: AppEnvironment,
): string {
	if (environment === 'development') return `dev.${domain}`
	return domain
}

/**
 * The canonical public site URL for an environment: `https://<resolved-domain>`.
 * Single source of truth shared by the runtime env (every target's
 * `contributeEnv().public.SITE_URL`) and the build args (Astro `site:` and
 * friends read it at build time) - so the value baked into the image and the
 * value injected at runtime can never drift.
 */
export function computeSiteUrl(
	domain: string,
	environment: AppEnvironment,
): string {
	return `https://${resolveDeployDomain(domain, environment)}`
}
