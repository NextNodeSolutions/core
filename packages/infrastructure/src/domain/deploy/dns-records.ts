import type { AppEnvironment } from '../environment.ts'

import { resolveDeployDomain } from './domain.ts'

const DNS_TTL_UNPROXIED = 300
const MIN_DOMAIN_PARTS = 2

export interface DesiredDnsRecord {
	readonly zoneName: string
	readonly name: string
	readonly type: 'CNAME'
	readonly content: string
	readonly proxied: boolean
	readonly ttl: number
}

export interface DnsRecordsInput {
	readonly domain: string
	readonly redirectDomains: ReadonlyArray<string>
	readonly environment: AppEnvironment
	readonly projectName: string
}

/**
 * Compute the desired DNS records for a Cloudflare Pages static site.
 *
 * Rules:
 * - Production: `{domain}` + each `redirect_domain` CNAME -> `{projectName}.pages.dev`, proxied
 * - Development: `dev.{domain}` CNAME -> `{projectName}.pages.dev`, unproxied
 *
 * Proxied records use TTL=1 (Cloudflare auto). Unproxied use TTL=300.
 * Dev stays unproxied so the zone cache is never applied (matches
 * "no cache on dev" requirement).
 */
export function computeDnsRecords(
	input: DnsRecordsInput,
): ReadonlyArray<DesiredDnsRecord> {
	const target = `${input.projectName}.pages.dev`

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
	readonly content: string
	readonly proxied: boolean
	readonly ttl: number
}

export type DnsRecordAction =
	| { readonly kind: 'skip' }
	| { readonly kind: 'create' }
	| { readonly kind: 'update'; readonly recordId: string }

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
