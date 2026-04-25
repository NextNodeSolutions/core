import { resolveDeployDomain } from '@/domain/deploy/domain.ts'
import type { AppEnvironment } from '@/domain/environment.ts'

export interface DesiredPagesDomain {
	readonly name: string
}

export interface PagesDomainsInput {
	readonly domain: string
	readonly redirectDomains: ReadonlyArray<string>
	readonly environment: AppEnvironment
}

/**
 * Compute the Cloudflare Pages custom domains that must be attached to the
 * Pages project for a given environment.
 *
 * Rules (mirror `computeDnsRecords` so attached domains and DNS records stay
 * in lockstep):
 * - Production: `{domain}` + every `redirect_domain`
 * - Development: `dev.{domain}`
 *
 * A Pages project only routes a request if its `Host` header matches a
 * domain attached to the project. Skipping this step leaves Cloudflare Pages
 * unable to resolve incoming traffic to the correct project, producing a 522.
 */
export function computePagesDomains(
	input: PagesDomainsInput,
): ReadonlyArray<DesiredPagesDomain> {
	if (input.environment === 'production') {
		return [
			{ name: input.domain },
			...input.redirectDomains.map(name => ({ name })),
		]
	}
	return [{ name: resolveDeployDomain(input.domain, input.environment) }]
}

export interface AttachedPagesDomain {
	readonly name: string
}

export type PagesDomainAction =
	| { readonly kind: 'skip' }
	| { readonly kind: 'attach' }

/**
 * Decide whether a desired Pages custom domain must be attached to the
 * project.
 *
 * Pages custom domains have no mutable configuration (just a name), so the
 * only two outcomes are "already attached" (skip) and "not attached"
 * (attach). Stale attached domains are reported separately — see
 * `findStalePagesDomains`.
 */
export function reconcilePagesDomain(
	desired: DesiredPagesDomain,
	attached: ReadonlyArray<AttachedPagesDomain>,
): PagesDomainAction {
	const match = attached.find(item => item.name === desired.name)
	if (match) return { kind: 'skip' }
	return { kind: 'attach' }
}

/**
 * Return the attached domains that are NOT part of the desired set.
 *
 * These are left in place — removal is outside the scope of the reconcile
 * loop and must be performed explicitly by an operator after confirming
 * they are no longer needed.
 */
export function findStalePagesDomains(
	desired: ReadonlyArray<DesiredPagesDomain>,
	attached: ReadonlyArray<AttachedPagesDomain>,
): ReadonlyArray<AttachedPagesDomain> {
	const desiredNames = new Set(desired.map(item => item.name))
	return attached.filter(item => !desiredNames.has(item.name))
}
