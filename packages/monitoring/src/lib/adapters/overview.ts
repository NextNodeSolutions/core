import { loadPageState } from '@/lib/adapters/load-page-state.ts'
import {
	listFleetVps,
	loadTrafficTotals,
} from '@/lib/adapters/victoria/fleet.ts'
import {
	loadFleetErrorCount,
	loadFleetLogs,
} from '@/lib/adapters/victoria/logs.ts'
import {
	loadHostMetrics,
	loadVpsSeries,
} from '@/lib/adapters/victoria/metrics.ts'
import { NULL_TRAFFIC_TOTALS } from '@/lib/domain/monitoring/host-facts.ts'
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
 * recent-log preview). Discovers the fleet from VictoriaMetrics, loads each
 * server's instant host metrics and CPU range series, and the fleet log
 * window - then hands the raw data to the pure `buildOverviewWindow`. A
 * single upstream failing degrades
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
		listFleetVps(),
	)
	const servers = serversState.kind === 'ok' ? serversState.data : []

	// The fleet pass, the traffic totals, the log preview window and the
	// windowed error tally hit independent upstream queries (and the tally is a
	// separate VictoriaLogs aggregate, not derived from the capped preview
	// list), so run them together and await once.
	const [fleet, trafficState, logsState, errorCountState] = await Promise.all(
		[
			loadFleetSnapshot(servers, windowHours),
			loadPageState(`overview.traffic.${String(windowHours)}`, () =>
				loadTrafficTotals(null, windowHours),
			),
			loadPageState(`overview.logs.${String(windowHours)}`, () =>
				loadFleetLogs(windowHours),
			),
			loadPageState(`overview.errors.${String(windowHours)}`, () =>
				loadFleetErrorCount(windowHours),
			),
		],
	)

	const logs = logsState.kind === 'ok' ? logsState.data : []
	const errorCount = errorCountState.kind === 'ok' ? errorCountState.data : 0
	// Both log queries hit the same upstream, so a full VictoriaLogs outage would
	// otherwise stack two near-identical banners. Surface the error-tally notice
	// ONLY when the stream itself loaded (i.e. the count alone failed) - the
	// stream's own notice already covers a shared outage.
	const errorCountNotice =
		logsState.kind === 'ok'
			? noticeFromState(errorCountState, 'logs', 'VictoriaLogs (erreurs)')
			: null
	const notices = [
		noticeFromState(serversState, 'fleet', 'VictoriaMetrics (flotte)'),
		noticeFromState(trafficState, 'fleet', 'VictoriaMetrics (trafic)'),
		noticeFromState(logsState, 'logs', 'VictoriaLogs'),
		errorCountNotice,
	].filter((notice): notice is OverviewNotice => notice !== null)

	const traffic =
		trafficState.kind === 'ok' ? trafficState.data : NULL_TRAFFIC_TOTALS

	return buildOverviewWindow({
		range,
		windowHours,
		servers,
		metricsByName: fleet.metricsByName,
		cpuSeriesByServer: fleet.cpuSeriesByServer,
		traffic,
		logs,
		errorCount,
		notices,
	})
}
