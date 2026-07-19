import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { jsonResponse } from '@/lib/adapters/json-response.ts'
import { loadPageState } from '@/lib/adapters/load-page-state.ts'
import { loadStateErrorResponse } from '@/lib/adapters/load-state-response.ts'
import { queryVictoriaMetricsRange } from '@/lib/adapters/victoria/client.ts'
import { getFleetVpsByName } from '@/lib/adapters/victoria/fleet.ts'
import { apiErr, apiOk } from '@/lib/domain/api-result.ts'
import { parseMetricRangeRequest } from '@/lib/domain/monitoring/metric-range-request.ts'

import type { APIRoute } from 'astro'

// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

const NOW_MS_DIVISOR = 1000

/**
 * Thin range proxy onto VictoriaMetrics for one of the four host gauges
 * of a VPS. Query params: `?metric=cpuPercent&hours=6`. Only the
 * whitelisted metric keys are accepted (no arbitrary PromQL passthrough),
 * and the window is bounded - the endpoint is tailnet-only and read-only,
 * but the validation keeps the surface tight regardless.
 *
 * The slug is resolved against the metrics-discovered fleet before it ever
 * reaches the PromQL label builder: an unknown slug is a 404, and the label
 * builder JSON-escapes the name, so a hostile slug cannot rewrite the
 * `vps_name` matcher. This mirrors the page path, which only renders metrics
 * for a VPS `getFleetVpsByName` matched.
 */
export const GET: APIRoute = async ({ params, url }) => {
	const { slug } = params
	if (!slug) {
		return jsonResponse(
			apiErr('bad_request', 'missing vps slug'),
			HTTP_STATUS.BAD_REQUEST,
		)
	}

	const parsed = parseMetricRangeRequest(
		{
			vpsName: slug,
			metric: url.searchParams.get('metric'),
			hours: url.searchParams.get('hours'),
		},
		Math.floor(Date.now() / NOW_MS_DIVISOR),
	)
	if (!parsed.ok) {
		return jsonResponse(
			apiErr('bad_request', parsed.error),
			HTTP_STATUS.BAD_REQUEST,
		)
	}

	const serverState = await loadPageState(`fleet.vps.${slug}.metrics`, () =>
		getFleetVpsByName(slug),
	)
	if (serverState.kind !== 'ok') {
		return loadStateErrorResponse(serverState)
	}
	if (serverState.data === null) {
		return jsonResponse(
			apiErr('not_found', `no VPS named "${slug}"`),
			HTTP_STATUS.NOT_FOUND,
		)
	}

	return runRangeQuery(`vps.${slug}.metrics`, parsed.request)
}

const runRangeQuery = async (
	scope: string,
	request: Parameters<typeof queryVictoriaMetricsRange>[0],
): Promise<Response> => {
	const state = await loadPageState(scope, () =>
		queryVictoriaMetricsRange(request),
	)
	if (state.kind === 'ok') {
		return jsonResponse(apiOk(state.data), HTTP_STATUS.OK)
	}
	return loadStateErrorResponse(state)
}
