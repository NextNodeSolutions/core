import type { CloudflareDnsRecord } from '@/lib/domain/cloudflare/dns-record.ts'

export const VPS_ACCESS_KINDS = ['internal', 'public'] as const
export type VpsAccessKind = (typeof VPS_ACCESS_KINDS)[number]

export interface VpsDnsMatch {
	readonly record: CloudflareDnsRecord
	readonly kind: VpsAccessKind
}

export interface VpsHostedProject {
	readonly hostname: string
	readonly zoneName: string
	readonly accessKind: VpsAccessKind
	readonly records: ReadonlyArray<CloudflareDnsRecord>
}

// "internal" wins if any match used the tailnet IP. Cloudflare DNS records
// for internal-only projects always point at the tailnet IP, so any internal
// hit is a strong signal that the project is Tailscale-gated.
const reduceAccessKind = (kinds: ReadonlyArray<VpsAccessKind>): VpsAccessKind =>
	kinds.includes('internal') ? 'internal' : 'public'

export const groupDnsMatchesByHostname = (
	matches: ReadonlyArray<VpsDnsMatch>,
): ReadonlyArray<VpsHostedProject> => {
	const byHostname = new Map<string, [VpsDnsMatch, ...Array<VpsDnsMatch>]>()
	for (const match of matches) {
		const existing = byHostname.get(match.record.name)
		if (existing) {
			existing.push(match)
			continue
		}
		byHostname.set(match.record.name, [match])
	}
	return Array.from(byHostname)
		.toSorted(([a], [b]) => a.localeCompare(b))
		.map(([hostname, group]) => ({
			hostname,
			zoneName: group[0].record.zoneName,
			accessKind: reduceAccessKind(group.map(m => m.kind)),
			records: group.map(m => m.record),
		}))
}
