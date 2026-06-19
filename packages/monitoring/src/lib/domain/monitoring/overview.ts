import {
	fleetCpuWindowAverage,
	summarizeFleet,
} from '@/lib/domain/monitoring/fleet-overview.ts'
import { formatTime } from '@/lib/domain/monitoring/format.ts'

import type { HetznerVps } from '@/lib/domain/hetzner/vps.ts'
import type { ServerMetrics } from '@/lib/domain/monitoring/fleet-overview.ts'
import type { FleetStat } from '@/lib/domain/monitoring/fleet-overview.ts'
import type { LogLevel, LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * The RANGE-DEPENDENT slice of the overview: the four fleet stats and the
 * recent-log preview, both computed for the selected time window. The
 * range-INDEPENDENT parts (fleet grid, alerts, recent deployments) are "now"
 * snapshots that the server renders once and never refetch, so they are not
 * part of this payload.
 *
 * Pure: callers pass the loaded upstream data + the window; this module shapes
 * it into a display-ready payload the `/api/overview` route serialises and the
 * island renders verbatim. No IO, no ambient clock.
 */

/** Number of recent lines shown in the overview log preview. */
export const OVERVIEW_STREAM_COUNT = 7

/** One ready-to-render line of the overview log preview. */
export interface OverviewStreamLine {
	readonly key: string
	readonly time: string
	readonly level: LogLevel | null
	readonly service: string | null
	readonly message: string
}

/** A degraded upstream surfaced to the user instead of a silent empty panel. */
export interface OverviewNotice {
	readonly section: string
	readonly label: string
	readonly message: string
}

/** The serialisable, range-dependent overview payload. */
export interface OverviewWindow {
	readonly range: string
	readonly windowHours: number
	readonly stats: ReadonlyArray<FleetStat>
	readonly stream: ReadonlyArray<OverviewStreamLine>
	readonly notices: ReadonlyArray<OverviewNotice>
}

export interface BuildOverviewWindowInput {
	readonly range: string
	readonly windowHours: number
	readonly servers: ReadonlyArray<HetznerVps>
	readonly metricsByName: Readonly<Record<string, ServerMetrics>>
	readonly cpuSeriesByServer: ReadonlyArray<ReadonlyArray<number>>
	readonly logs: ReadonlyArray<LogLine>
	readonly notices: ReadonlyArray<OverviewNotice>
}

const toStreamLine = (line: LogLine, index: number): OverviewStreamLine => ({
	key: `${String(index)}:${line.time}`,
	// `line.time` is an ISO timestamp; `formatTime` wants epoch ms.
	time: formatTime(new Date(line.time).getTime()),
	level: line.level,
	service: line.service,
	message: line.message,
})

/** Shape the loaded upstream data into the range-dependent overview payload. */
export const buildOverviewWindow = (
	input: BuildOverviewWindowInput,
): OverviewWindow => {
	const { average, nodeCount } = fleetCpuWindowAverage(
		input.cpuSeriesByServer,
	)
	const errorCount = input.logs.filter(line => line.level === 'error').length
	const stats = summarizeFleet({
		servers: input.servers,
		metricsByName: input.metricsByName,
		errorCount,
		windowHours: input.windowHours,
		cpuWindowAverage: average,
		cpuNodeCount: nodeCount,
	})
	const stream = input.logs
		.slice(0, OVERVIEW_STREAM_COUNT)
		.map((line, index) => toStreamLine(line, index))
	return {
		range: input.range,
		windowHours: input.windowHours,
		stats,
		stream,
		notices: input.notices,
	}
}
