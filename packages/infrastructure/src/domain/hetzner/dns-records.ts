import type { DesiredDnsRecord } from '../cloudflare/dns-records.ts'
import { extractRootDomain } from '../cloudflare/dns-records.ts'
import { resolveDeployDomain } from '../deploy/domain.ts'
import type { AppEnvironment } from '../environment.ts'

const DNS_TTL_UNPROXIED = 300

export interface VpsDnsRecordsInput {
	readonly domain: string
	readonly environment: AppEnvironment
	readonly publicIp: string
}

/**
 * Compute the desired DNS records for a Hetzner VPS deploy target.
 *
 * Rules:
 * - Production: `{domain}` A record → VPS public IP, proxied (Cloudflare CDN)
 * - Development: `dev.{domain}` A record → VPS public IP, unproxied (direct)
 *
 * Proxied records use TTL=1 (Cloudflare auto). Unproxied use TTL=300.
 */
export function computeVpsDnsRecords(
	input: VpsDnsRecordsInput,
): ReadonlyArray<DesiredDnsRecord> {
	const hostname = resolveDeployDomain(input.domain, input.environment)
	const proxied = input.environment === 'production'

	return [
		{
			zoneName: extractRootDomain(hostname),
			name: hostname,
			type: 'A',
			content: input.publicIp,
			proxied,
			ttl: proxied ? 1 : DNS_TTL_UNPROXIED,
		},
	]
}
