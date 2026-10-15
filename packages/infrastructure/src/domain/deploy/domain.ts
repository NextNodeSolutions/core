import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * Resolve the actual domain for a given environment.
 *
 * - Production:  `{domain}` as-is
 * - Development: `dev.{domain}`
 *
 * This is the single source of truth for the dev subdomain convention.
 * Used by Worker routes, zone rules, Access applications and R2 custom domains.
 */
export function resolveDeployDomain(
	domain: string,
	environment: AppEnvironment,
): string {
	if (environment === 'development') return `dev.${domain}`
	return domain
}

/**
 * The public URL of a host for an environment: `https://<resolved-domain>`.
 * Used by the smoke checks, the redirects and the deploy summary.
 */
export function computeSiteUrl(
	domain: string,
	environment: AppEnvironment,
): string {
	return `https://${resolveDeployDomain(domain, environment)}`
}
