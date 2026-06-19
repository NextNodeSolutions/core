import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { jsonResponse } from '@/lib/adapters/json-response.ts'
import { loadPageState } from '@/lib/adapters/load-page-state.ts'
import { loadOverviewWindow } from '@/lib/adapters/overview.ts'
import { apiErr } from '@/lib/domain/api-result.ts'

import type { APIRoute } from 'astro'
import type { LoadState } from '@/lib/domain/load-state.ts'
import type { OverviewWindow } from '@/lib/domain/monitoring/overview.ts'

/**
 * Range-dependent overview feed for the dynamic dashboard island. The island
 * fetches this once per time-range and swaps the stat grid + log preview
 * client-side. `loadOverviewWindow` degrades each upstream INTO the payload's
 * `notices` rather than throwing, so a partial outage still returns a usable
 * 200 (with notices) - the route only maps an unexpected failure of the
 * assembly itself to 5xx. Mirrors the thin command pattern of api/logs.ts.
 */

// oxlint-disable-next-line nextnode/boolean-naming -- prerender is Astro's required route export name
export const prerender = false

const DEFAULT_RANGE = 'live'

const okOverviewResponse = (window: OverviewWindow): Response =>
	new Response(JSON.stringify(window), {
		status: HTTP_STATUS.OK,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	})

const assertNeverState = (state: never): never => {
	throw new Error(`Unhandled load state: ${JSON.stringify(state)}`)
}

const toResponse = (state: LoadState<OverviewWindow>): Response => {
	switch (state.kind) {
		case 'ok':
			return okOverviewResponse(state.data)
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

/**
 * The pure request handler, separated from the Astro `GET` wiring so it can be
 * driven by a plain `URL` in tests (no `APIContext` fake, no cast).
 */
export const handleOverviewRequest = async (url: URL): Promise<Response> => {
	const range = url.searchParams.get('range') ?? DEFAULT_RANGE
	const state = await loadPageState('api.overview', () =>
		loadOverviewWindow(range),
	)
	return toResponse(state)
}

export const GET: APIRoute = ({ url }) => handleOverviewRequest(url)
