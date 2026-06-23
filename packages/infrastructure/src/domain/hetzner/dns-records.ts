import { extractRootDomain } from '#/domain/cloudflare/dns-records.ts'
import { resolveDeployDomain } from '#/domain/deploy/domain.ts'

import type {
	DesiredDnsRecord,
	DnsRecordLookup,
} from '#/domain/cloudflare/dns-records.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const DNS_TTL_UNPROXIED = 300

export interface VpsDnsRecordsInput {
	readonly domain: string
	readonly environment: AppEnvironment
	readonly publicIp: string
	readonly internal: boolean
	readonly tailnetIp: string
}

/**
 * Compute the desired DNS records for a Hetzner VPS deploy target.
 *
 * Public rules:
 * - Production: `{domain}` A record → VPS public IP, proxied (Cloudflare CDN)
 * - Development: `dev.{domain}` A record → VPS public IP, unproxied (direct)
 *
 * Internal rules:
 * - A record → tailnet IP, never proxied (CGNAT range, unreachable from public internet)
 *
 * Proxied records use TTL=1 (Cloudflare auto). Unproxied use TTL=300.
 */
/**
 * Compute the DNS record lookups for a Hetzner VPS teardown.
 * Returns only the zoneName + name pairs needed to find and delete
 * records - no IP required.
 */
export function computeVpsDnsLookups(input: {
	readonly domain: string
	readonly environment: AppEnvironment
}): ReadonlyArray<DnsRecordLookup> {
	const hostname = resolveDeployDomain(input.domain, input.environment)
	return [{ zoneName: extractRootDomain(hostname), name: hostname }]
}

/**
 * Cloudflare's free Universal SSL edge certificate covers the zone apex and a
 * SINGLE-level wildcard (`*.<zone>`) only. A hostname two or more labels below
 * the apex - e.g. `admin.fleurs.nextnode.fr` under zone `nextnode.fr`, which
 * arises whenever `project.domain` is itself a subdomain - gets NO edge
 * certificate on a Free/Pro zone (Advanced Certificate Manager / Total TLS
 * would be required), so a PROXIED record there fails the client<->Cloudflare
 * TLS handshake outright. Such hostnames must stay DNS-only so the VPS Caddy
 * serves its own Let's Encrypt certificate directly (valid at any depth).
 *
 * Apex and one-label hostnames - the norm when `project.domain` is a
 * registrable domain - are covered by Universal SSL and stay proxied.
 */
function isCoveredByUniversalSsl(hostname: string, zoneName: string): boolean {
	if (hostname === zoneName) return true
	const subdomain = hostname.slice(0, -(zoneName.length + 1))
	return !subdomain.includes('.')
}

export function computeVpsDnsRecords(
	input: VpsDnsRecordsInput,
): ReadonlyArray<DesiredDnsRecord> {
	const hostname = resolveDeployDomain(input.domain, input.environment)
	const zoneName = extractRootDomain(hostname)

	if (input.internal) {
		return [
			{
				zoneName,
				name: hostname,
				type: 'A',
				content: input.tailnetIp,
				proxied: false,
				ttl: DNS_TTL_UNPROXIED,
			},
		]
	}

	const proxied =
		input.environment === 'production' &&
		isCoveredByUniversalSsl(hostname, zoneName)
	return [
		{
			zoneName,
			name: hostname,
			type: 'A',
			content: input.publicIp,
			proxied,
			ttl: proxied ? 1 : DNS_TTL_UNPROXIED,
		},
	]
}
