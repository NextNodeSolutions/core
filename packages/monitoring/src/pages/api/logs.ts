import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { jsonResponse } from '@/lib/adapters/json-response.ts'
import { loadPageState } from '@/lib/adapters/load-page-state.ts'
import { loadFleetLogs, loadFleetStats } from '@/lib/adapters/victoria/logs.ts'
import { apiErr } from '@/lib/domain/api-result.ts'
import { EMPTY_FLEET_STATS } from '@/lib/domain/monitoring/log-aggregates.ts'
import { rangeToHours } from '@/lib/domain/monitoring/vps-metrics.ts'

import type { APIRoute } from 'astro'
import type { LoadState } from '@/lib/domain/load-state.ts'
import type { FleetLogStats } from '@/lib/domain/monitoring/log-aggregates.ts'
import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'

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
}

const okLogsResponse = (
	logs: ReadonlyArray<LogLine>,
	stats: FleetLogStats,
): Response => {
	const payload: LogsPayload = { logs, stats }
	return new Response(JSON.stringify(payload), {
		status: HTTP_STATUS.OK,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	})
}

const toResponse = (
	state: LoadState<ReadonlyArray<LogLine>>,
	stats: FleetLogStats,
): Response => {
	switch (state.kind) {
		case 'ok':
			return okLogsResponse(state.data, stats)
		case 'upstream_error':
			return jsonResponse(
				apiErr('upstream_error', state.message),
				HTTP_STATUS.BAD_GATEWAY,
			)
		case 'missing_config':
			return jsonResponse(
				apiErr('missing_config', state.message),
				HTTP_STATUS.INTERNAL_SERVER_ERROR,
			)
		case 'internal_error':
			return jsonResponse(
				apiErr('internal_error', state.message),
				HTTP_STATUS.INTERNAL_SERVER_ERROR,
			)
		default:
			return assertNeverState(state)
	}
}

const assertNeverState = (state: never): never => {
	throw new Error(`Unhandled load state: ${JSON.stringify(state)}`)
}

/**
 * The pure request handler, separated from the Astro `GET` wiring so it can be
 * driven by a plain `URL` in tests (no `APIContext` fake, no cast).
 */
export const handleLogsRequest = async (url: URL): Promise<Response> => {
	const range = url.searchParams.get('range') ?? DEFAULT_RANGE
	// `rangeToHours` already maps `live` -> 1h, so no special-casing here.
	const hours = rangeToHours(range)
	// One stable clock for both the bucket grid and any relative-time rendering.
	const nowMs = Date.now()
	// The line sample and the windowed aggregate hit VictoriaLogs independently;
	// fire both and await once. The list is the contract that gates the page, so
	// only its failure becomes an error response; a stats failure degrades to an
	// empty histogram (loud-logged by loadPageState) rather than blanking logs.
	const [logsState, statsState] = await Promise.all([
		loadPageState('logs.fleet', () => loadFleetLogs(hours)),
		loadPageState('logs.stats', () => loadFleetStats(hours, nowMs)),
	])
	const stats = statsState.kind === 'ok' ? statsState.data : EMPTY_FLEET_STATS
	return toResponse(logsState, stats)
}

export const GET: APIRoute = ({ url }) => handleLogsRequest(url)
