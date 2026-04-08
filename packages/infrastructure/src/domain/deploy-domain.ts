import type { AppEnvironment } from './environment.ts'

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
