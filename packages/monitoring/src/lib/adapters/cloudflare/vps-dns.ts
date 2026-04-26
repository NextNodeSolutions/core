import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import { listDnsRecordsByContent } from '@/lib/adapters/cloudflare/dns-records.ts'
import { listZones } from '@/lib/adapters/cloudflare/zones.ts'
import type {
	VpsAccessKind,
	VpsDnsMatch,
} from '@/lib/domain/cloudflare/vps-hosted-project.ts'

export interface ListDnsMatchesForVpsOptions {
	readonly client: CloudflareClient
	readonly publicIpv4: string | null
	readonly publicIpv6: string | null
	readonly tailnetIp: string | null
}

interface QueryPlan {
	readonly content: string
	readonly kind: VpsAccessKind
}

const buildQueryPlan = (
	options: ListDnsMatchesForVpsOptions,
): ReadonlyArray<QueryPlan> => {
	const plans: Array<QueryPlan> = []
	if (options.publicIpv4)
		plans.push({ content: options.publicIpv4, kind: 'public' })
	if (options.publicIpv6)
		plans.push({ content: options.publicIpv6, kind: 'public' })
	if (options.tailnetIp)
		plans.push({ content: options.tailnetIp, kind: 'internal' })
	return plans
}

export const listDnsMatchesForVps = async (
	options: ListDnsMatchesForVpsOptions,
): Promise<ReadonlyArray<VpsDnsMatch>> => {
	const plans = buildQueryPlan(options)
	if (plans.length === 0) return []

	const zones = await listZones(options.client)
	const queries = zones.flatMap(zone =>
		plans.map(async plan => {
			const records = await listDnsRecordsByContent({
				client: options.client,
				zoneId: zone.id,
				zoneName: zone.name,
				content: plan.content,
			})
			return records.map(record => ({ record, kind: plan.kind }))
		}),
	)
	const results = await Promise.all(queries)
	return results.flat()
}
