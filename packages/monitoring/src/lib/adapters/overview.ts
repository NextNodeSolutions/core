import { ENV_KEYS, requireEnv } from '@/lib/adapters/env.ts'
import { listServers } from '@/lib/adapters/hetzner/servers.ts'
import { loadPageState } from '@/lib/adapters/load-page-state.ts'
import { loadFleetLogs } from '@/lib/adapters/victoria/logs.ts'
import {
	loadHostMetrics,
	loadVpsSeries,
} from '@/lib/adapters/victoria/metrics.ts'
import { buildOverviewWindow } from '@/lib/domain/monitoring/overview.ts'
import { rangeToHours } from '@/lib/domain/monitoring/vps-metrics.ts'

import type { LoadState } from '@/lib/domain/load-state.ts'
import type { ServerMetrics } from '@/lib/domain/monitoring/fleet-overview.ts'
import type {
	OverviewNotice,
	OverviewWindow,
} from '@/lib/domain/monitoring/overview.ts'

/**
 * Adapter for the RANGE-DEPENDENT overview payload (the four fleet stats + the
 * recent-log preview). Loads the Hetzner inventory, each server's instant host
 * metrics and CPU range series, and the fleet log window - then hands the raw
 * data to the pure `buildOverviewWindow`. A single upstream failing degrades
 * that section to a notice rather than failing the whole payload; the stats and
 * stream still render from whatever loaded (never a silent empty success).
 *
 * Used by both `/api/overview` (range changes) and the page's first-paint seed.
 */

const NULL_METRICS: ServerMetrics = {
	cpuPercent: null,
	memoryPercent: null,
	diskPercent: null,
}

const noticeFromState = (
	state: LoadState<unknown>,
	section: string,
	label: string,
): OverviewNotice | null => {
	if (state.kind === 'ok') return null
	return { section, label, message: state.message }
}

interface FleetSnapshot {
	readonly metricsByName: Record<string, ServerMetrics>
	readonly cpuSeriesByServer: number[][]
}

/**
 * Per server, the instant host metrics and the CPU range series for the window
 * fire together; every server fires together. A failed metric/series degrades
 * that server's contribution to nulls/empty (CPU average just sees fewer
 * samples) rather than a notice - only the fleet/logs sources are notice-worthy.
 */
const loadFleetSnapshot = async (
	servers: ReadonlyArray<{ readonly name: string }>,
	windowHours: number,
): Promise<FleetSnapshot> => {
	const loads = await Promise.all(
		servers.map(async server => {
			const [metricsState, seriesState] = await Promise.all([
				loadPageState(`overview.metrics.${server.name}`, () =>
					loadHostMetrics(server.name),
				),
				loadPageState(
					`overview.spark.${server.name}.${String(windowHours)}`,
					() => loadVpsSeries(server.name, 'cpu', windowHours),
				),
			])
			return { name: server.name, metricsState, seriesState }
		}),
	)

	const metricsByName: Record<string, ServerMetrics> = {}
	const cpuSeriesByServer: number[][] = []
	for (const load of loads) {
		const metrics =
			load.metricsState.kind === 'ok'
				? load.metricsState.data
				: NULL_METRICS
		metricsByName[load.name] = {
			cpuPercent: metrics.cpuPercent,
			memoryPercent: metrics.memoryPercent,
			diskPercent: metrics.diskPercent,
		}
		const series =
			load.seriesState.kind === 'ok' ? load.seriesState.data : []
		cpuSeriesByServer.push(series.map(point => point.v))
	}
	return { metricsByName, cpuSeriesByServer }
}

export const loadOverviewWindow = async (
	range: string,
): Promise<OverviewWindow> => {
	const windowHours = rangeToHours(range)

	const serversState = await loadPageState('overview.servers', () =>
		listServers(requireEnv(ENV_KEYS.HETZNER_API_TOKEN)),
	)
	const servers = serversState.kind === 'ok' ? serversState.data : []

	// The fleet pass and the log window hit independent upstreams, so run them
	// together and await once.
	const [fleet, logsState] = await Promise.all([
		loadFleetSnapshot(servers, windowHours),
		loadPageState(`overview.logs.${String(windowHours)}`, () =>
			loadFleetLogs(windowHours),
		),
	])

	const logs = logsState.kind === 'ok' ? logsState.data : []
	const notices = [
		noticeFromState(serversState, 'fleet', 'Hetzner API'),
		noticeFromState(logsState, 'logs', 'VictoriaLogs'),
	].filter((notice): notice is OverviewNotice => notice !== null)

	return buildOverviewWindow({
		range,
		windowHours,
		servers,
		metricsByName: fleet.metricsByName,
		cpuSeriesByServer: fleet.cpuSeriesByServer,
		logs,
		notices,
	})
}
