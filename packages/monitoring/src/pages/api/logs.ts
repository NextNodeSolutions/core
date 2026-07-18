import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { loadPageState } from '@/lib/adapters/load-page-state.ts'
import { loadStateErrorResponse } from '@/lib/adapters/load-state-response.ts'
import {
	loadFleetLogs,
	loadFleetStats,
	loadLogFacets,
} from '@/lib/adapters/victoria/logs.ts'
import { EMPTY_FLEET_STATS } from '@/lib/domain/monitoring/log-aggregates.ts'
import { rangeToHours } from '@/lib/domain/monitoring/vps-metrics.ts'

import type { APIRoute } from 'astro'
import type { FleetLogStats } from '@/lib/domain/monitoring/log-aggregates.ts'
import type {
	FleetLogFilter,
	LogFacets,
	LogLine,
} from '@/lib/domain/monitoring/log-query.ts'

const EMPTY_LOG_FACETS: LogFacets = { services: [], vps: [] }

/**
 * Fleet-log JSON feed for the dynamic /logs island. The island fetches this
 * once per time-range and does all filtering / selection / bucketing
 * client-side, so this route's only job is: read the range, load that window's
 * logs, hand back `{ logs }`. An upstream VictoriaLogs failure maps to 502 with
 * an error body - never a silent empty 200 that the UI would mistake for "no
 * logs". Mirrors the thin command pattern of the other api/ routes.
 */

// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

const DEFAULT_RANGE = '6h'

/**
 * Success body shape the island reads: the recent line SAMPLE (the list) plus
 * the WINDOWED aggregates (histogram + per-level + total). The two are distinct
 * on purpose - the sample is the 200 newest lines, the stats cover the whole
 * window - so the time filter visibly moves the histogram and counts.
 */
interface LogsPayload {
	readonly logs: ReadonlyArray<LogLine>
	readonly stats: FleetLogStats
	readonly facets: LogFacets
}

const okLogsResponse = (
	logs: ReadonlyArray<LogLine>,
	stats: FleetLogStats,
	facets: LogFacets,
): Response => {
	const payload: LogsPayload = { logs, stats, facets }
	return new Response(JSON.stringify(payload), {
		status: HTTP_STATUS.OK,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	})
}

/**
 * The pure request handler, separated from the Astro `GET` wiring so it can be
 * driven by a plain `URL` in tests (no `APIContext` fake, no cast).
 */
/** Read a filter value, treating a missing/empty/`all` param as "no filter". */
const filterParam = (url: URL, key: string): string | undefined => {
	const param = url.searchParams.get(key)
	return param && param.length > 0 && param !== 'all' ? param : undefined
}

export const handleLogsRequest = async (url: URL): Promise<Response> => {
	const range = url.searchParams.get('range') ?? DEFAULT_RANGE
	// `rangeToHours` maps `live` to a short 5-min window; no special-casing here.
	const hours = rangeToHours(range)
	// Server-side scope: the sample and the windowed stats are BOTH filtered, so
	// the list, histogram and counts all reflect the operator's facets/search.
	const filter: FleetLogFilter = {
		service: filterParam(url, 'service'),
		vps: filterParam(url, 'vps'),
		query: filterParam(url, 'q'),
	}
	// One stable clock for both the bucket grid and any relative-time rendering.
	const nowMs = Date.now()
	// Sample, windowed aggregate and facet values hit VictoriaLogs independently;
	// fire all three and await once. The list gates the page, so only its failure
	// becomes an error response; stats/facets degrade to empty (loud-logged by
	// loadPageState) rather than blanking the logs.
	const [logsState, statsState, facetsState] = await Promise.all([
		loadPageState('logs.fleet', () => loadFleetLogs(hours, filter)),
		loadPageState('logs.stats', () => loadFleetStats(hours, nowMs, filter)),
		loadPageState('logs.facets', () => loadLogFacets(hours)),
	])
	const stats = statsState.kind === 'ok' ? statsState.data : EMPTY_FLEET_STATS
	const facets =
		facetsState.kind === 'ok' ? facetsState.data : EMPTY_LOG_FACETS
	return logsState.kind === 'ok'
		? okLogsResponse(logsState.data, stats, facets)
		: loadStateErrorResponse(logsState)
}

export const GET: APIRoute = ({ url }) => handleLogsRequest(url)
