import { ENV_KEYS, requireEnv } from '@/lib/adapters/env.ts'
import { listServers } from '@/lib/adapters/hetzner/servers.ts'
import { loadVpsSeries } from '@/lib/adapters/victoria/metrics.ts'
import { mapWithConcurrency } from '@/lib/domain/concurrency.ts'

import type { CmpMetric } from '@/islands/fleet-cmp/metrics.ts'
import type { CmpLine } from '@/lib/domain/monitoring/cmp-line.ts'

/**
 * Fleet-comparison fan-out: list the Hetzner fleet, then load one peer's range
 * series per VPS for the chosen metric. This is the same bounded fan-out the
 * VPS detail page runs server-side (one range query per peer, capped at
 * `CMP_CONCURRENCY`), lifted into an adapter so the `/api/vps/[slug]/cmp` route
 * reuses it for the client-side metric swap. A failure inside `listServers` or
 * any `loadVpsSeries` propagates to `loadPageState`, which classifies it as an
 * upstream error - this adapter makes no business decision of its own.
 */

const CMP_CONCURRENCY = 6

export const loadFleetCmp = async (
	metric: CmpMetric,
	hours: number,
): Promise<ReadonlyArray<CmpLine>> => {
	const token = requireEnv(ENV_KEYS.HETZNER_API_TOKEN)
	const fleet = await listServers(token)
	return mapWithConcurrency(
		fleet,
		CMP_CONCURRENCY,
		async (peer): Promise<CmpLine> => {
			const points = await loadVpsSeries(peer.name, metric, hours)
			return { name: peer.name, values: points.map(point => point.v) }
		},
	)
}
