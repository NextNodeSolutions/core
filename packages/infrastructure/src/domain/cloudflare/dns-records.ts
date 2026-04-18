import { resolveDeployDomain } from '../deploy/domain.ts'
import type { AppEnvironment } from '../environment.ts'

const DNS_TTL_UNPROXIED = 300
const MIN_DOMAIN_PARTS = 2

/**
 * Minimal identifier for a DNS record - just enough to look it up
 * in Cloudflare. Used by teardown to find records to delete without
 * needing the full record content (IP, subdomain, etc.).
 */
export interface DnsRecordLookup {
	readonly zoneName: string
	readonly name: string
}

export interface DesiredDnsRecord extends DnsRecordLookup {
	readonly type: 'CNAME' | 'A'
	readonly content: string
	readonly proxied: boolean
	readonly ttl: number
}

export interface DnsRecordsInput {
	readonly domain: string
	readonly redirectDomains: ReadonlyArray<string>
	readonly environment: AppEnvironment
	/**
	 * The actual `*.pages.dev` hostname assigned by Cloudflare to the
	 * project (e.g. `my-site.pages.dev` or, when the desired name is
	 * already taken globally, `my-site-6zu.pages.dev`). MUST be read
	 * from the Pages API (`result.subdomain`) — never derived from the
	 * project name, since CF auto-suffixes on cross-account collisions
	 * and a CNAME pointing at the bare project name yields a
	 * "CNAME Cross-User Banned" (1014) error.
	 */
	readonly pagesSubdomain: string
}

/**
 * Compute the desired DNS records for a Cloudflare Pages static site.
 *
 * Rules:
 * - Production: `{domain}` + each `redirect_domain` CNAME -> `{pagesSubdomain}`, proxied
 * - Development: `dev.{domain}` CNAME -> `{pagesSubdomain}`, unproxied
 *
 * Proxied records use TTL=1 (Cloudflare auto). Unproxied use TTL=300.
 * Dev stays unproxied so the zone cache is never applied (matches
 * "no cache on dev" requirement).
 */
export function computeDnsRecords(
	input: DnsRecordsInput,
): ReadonlyArray<DesiredDnsRecord> {
	const target = input.pagesSubdomain

	if (input.environment === 'production') {
		return [
			buildCname(input.domain, target, true),
			...input.redirectDomains.map(redirectDomain =>
				buildCname(redirectDomain, target, true),
			),
		]
	}

	return [
		buildCname(
			resolveDeployDomain(input.domain, input.environment),
			target,
			false,
		),
	]
}

/**
 * Compute the DNS record lookups for a Cloudflare Pages teardown.
 * Returns only the zoneName + name pairs needed to find and delete
 * records - no subdomain or content required.
 */
export function computePagesDnsLookups(input: {
	readonly domain: string
	readonly redirectDomains: ReadonlyArray<string>
	readonly environment: AppEnvironment
}): ReadonlyArray<DnsRecordLookup> {
	if (input.environment === 'production') {
		return [
			buildLookup(input.domain),
			...input.redirectDomains.map(buildLookup),
		]
	}

	return [buildLookup(resolveDeployDomain(input.domain, input.environment))]
}

function buildLookup(hostname: string): DnsRecordLookup {
	return {
		zoneName: extractRootDomain(hostname),
		name: hostname,
	}
}

function buildCname(
	name: string,
	target: string,
	proxied: boolean,
): DesiredDnsRecord {
	return {
		zoneName: extractRootDomain(name),
		name,
		type: 'CNAME',
		content: target,
		proxied,
		ttl: proxied ? 1 : DNS_TTL_UNPROXIED,
	}
}

export interface ExistingDnsRecord {
	readonly id: string
	readonly type: string
	readonly content: string
	readonly proxied: boolean
	readonly ttl: number
}

export type DnsRecordAction =
	| { readonly kind: 'skip' }
	| { readonly kind: 'create' }
	| { readonly kind: 'update'; readonly recordId: string }
	| {
			readonly kind: 'replace'
			readonly deleteRecordIds: ReadonlyArray<string>
	  }

/**
 * Decide what to do with a desired DNS record given the currently
 * existing records with the same name+type in the zone.
 *
 * - No match -> create
 * - Exact match (content + proxied + ttl) -> skip (idempotent)
 * - Mismatch -> update the first existing record
 */
export function reconcileDnsRecord(
	desired: DesiredDnsRecord,
	existing: ReadonlyArray<ExistingDnsRecord>,
): DnsRecordAction {
	if (existing.length === 0) return { kind: 'create' }

	const conflicting = existing.filter(r => r.type !== desired.type)
	if (conflicting.length > 0) {
		return {
			kind: 'replace',
			deleteRecordIds: conflicting.map(r => r.id),
		}
	}

	const current = existing[0]
	if (!current) return { kind: 'create' }
	if (
		current.content === desired.content &&
		current.proxied === desired.proxied &&
		current.ttl === desired.ttl
	) {
		return { kind: 'skip' }
	}
	return { kind: 'update', recordId: current.id }
}

/**
 * Extract the Cloudflare zone root domain from a full hostname.
 * Uses the simple "last two parts" heuristic, matching Cloudflare's
 * typical zone naming (eTLD+1). Callers must own their own zones
 * under a single-part TLD.
 *
 * Examples:
 * - `example.com`        -> `example.com`
 * - `dev.example.com`    -> `example.com`
 * - `a.b.example.com`    -> `example.com`
 */
export function extractRootDomain(fqdn: string): string {
	const parts = fqdn.split('.')
	if (parts.length < MIN_DOMAIN_PARTS) return fqdn
	return parts.slice(-MIN_DOMAIN_PARTS).join('.')
}
