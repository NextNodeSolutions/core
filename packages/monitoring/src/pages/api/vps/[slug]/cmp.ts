import { DEFAULT_CMP_METRIC, isCmpMetric } from '@/islands/fleet-cmp/metrics.ts'
import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { jsonResponse } from '@/lib/adapters/json-response.ts'
import { loadPageState } from '@/lib/adapters/load-page-state.ts'
import { loadStateErrorResponse } from '@/lib/adapters/load-state-response.ts'
import { loadFleetCmp } from '@/lib/adapters/victoria/fleet-cmp.ts'
import { apiErr } from '@/lib/domain/api-result.ts'
import { rangeToHours } from '@/lib/domain/monitoring/vps-metrics.ts'

import type { APIRoute } from 'astro'
import type { CmpLine } from '@/lib/domain/monitoring/cmp-line.ts'

/**
 * Fleet-comparison JSON feed for the dynamic VPS-detail island. The island
 * fetches this once per metric and swaps the chart client-side, so this route's
 * only job is: validate the metric, load that metric's per-peer series for the
 * range window, hand back `{ lines }`. An unknown metric is a client mistake ->
 * 400; an upstream VictoriaMetrics failure -> 502, never a silent
 * empty 200. Mirrors the thin command pattern of api/logs.ts.
 */

// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

const DEFAULT_RANGE = 'live'

/** Success body shape the island reads: one comparison line per peer. */
interface CmpPayload {
	readonly lines: ReadonlyArray<CmpLine>
}

const okCmpResponse = (lines: ReadonlyArray<CmpLine>): Response => {
	const payload: CmpPayload = { lines }
	return new Response(JSON.stringify(payload), {
		status: HTTP_STATUS.OK,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	})
}

/**
 * The pure request handler, separated from the Astro `GET` wiring so it can be
 * driven by a plain `slug` + `URL` in tests (no `APIContext` fake, no cast).
 * `slug` scopes the load-state key only; the fan-out covers the whole fleet.
 */
export const handleCmpRequest = async (
	slug: string,
	url: URL,
): Promise<Response> => {
	const metric = url.searchParams.get('metric') ?? DEFAULT_CMP_METRIC
	if (!isCmpMetric(metric)) {
		return jsonResponse(
			apiErr('bad_request', `Métrique inconnue : "${metric}".`),
			HTTP_STATUS.BAD_REQUEST,
		)
	}
	const range = url.searchParams.get('range') ?? DEFAULT_RANGE
	const hours = rangeToHours(range)
	const state = await loadPageState(`vps.${slug}.cmp.${metric}`, () =>
		loadFleetCmp(metric, hours),
	)
	return state.kind === 'ok'
		? okCmpResponse(state.data)
		: loadStateErrorResponse(state)
}

export const GET: APIRoute = ({ params, url }) =>
	handleCmpRequest(params.slug ?? '', url)
