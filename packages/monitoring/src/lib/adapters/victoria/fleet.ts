import {
	MOCK_DATA,
	mockFleet,
	mockFleetVpsByName,
	mockHostFacts,
	mockTrafficTotals,
} from '@/lib/adapters/mock-data.ts'
import { queryVictoriaMetricsInstant } from '@/lib/adapters/victoria/client.ts'
import {
	FLEET_DISCOVERY_EXPR,
	parseFleetVps,
} from '@/lib/domain/monitoring/fleet-vps.ts'
import { buildHostFactExprs } from '@/lib/domain/monitoring/host-facts.ts'
import { buildTrafficTotalExpr } from '@/lib/domain/monitoring/node-exporter-exprs.ts'
import {
	parseInstantQuery,
	parseInstantScalar,
} from '@/lib/domain/monitoring/promql-response.ts'

import type { FleetVps } from '@/lib/domain/monitoring/fleet-vps.ts'
import type {
	HostFacts,
	TrafficTotals,
} from '@/lib/domain/monitoring/host-facts.ts'

/**
 * Fleet discovery over VictoriaMetrics: the fleet IS the set of VPSs the
 * central scraper currently targets, whatever provider hosts them. No
 * cloud-inventory API involved - a client VPS in a foreign Hetzner
 * project (or any other provider) appears the moment its metrics do.
 */

const fetchFleet = async (): Promise<ReadonlyArray<FleetVps>> => {
	const payload = await queryVictoriaMetricsInstant(FLEET_DISCOVERY_EXPR)
	return parseFleetVps(parseInstantQuery(payload))
}

export const listFleetVps = (): Promise<ReadonlyArray<FleetVps>> =>
	MOCK_DATA ? Promise.resolve(mockFleet()) : fetchFleet()

export const getFleetVpsByName = async (
	name: string,
): Promise<FleetVps | null> => {
	if (MOCK_DATA) return mockFleetVpsByName(name)
	const fleet = await fetchFleet()
	return fleet.find(vps => vps.name === name) ?? null
}

const scalarOrNull = async (expr: string): Promise<number | null> => {
	const payload = await queryVictoriaMetricsInstant(expr)
	return parseInstantScalar(payload)
}

/**
 * Hardware facts of one VPS from node_exporter. Each fact is independent:
 * one failing query leaves that field null, not the whole shape.
 */
export const loadHostFacts = async (vpsName: string): Promise<HostFacts> => {
	if (MOCK_DATA) return mockHostFacts(vpsName)
	const exprs = buildHostFactExprs(vpsName)
	const [cores, memoryTotalBytes, diskTotalBytes] = await Promise.all([
		scalarOrNull(exprs.cores),
		scalarOrNull(exprs.memoryTotalBytes),
		scalarOrNull(exprs.diskTotalBytes),
	])
	return { cores, memoryTotalBytes, diskTotalBytes }
}

/**
 * Network totals over the window - one VPS when `vpsName` is given, the
 * whole fleet when `null`.
 */
export const loadTrafficTotals = async (
	vpsName: string | null,
	windowHours: number,
): Promise<TrafficTotals> => {
	if (MOCK_DATA) return mockTrafficTotals(vpsName, windowHours)
	const [inBytes, outBytes] = await Promise.all([
		scalarOrNull(buildTrafficTotalExpr(vpsName, 'in', windowHours)),
		scalarOrNull(buildTrafficTotalExpr(vpsName, 'out', windowHours)),
	])
	return { inBytes, outBytes }
}
