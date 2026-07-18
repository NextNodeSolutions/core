import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { loadPageState } from '@/lib/adapters/load-page-state.ts'
import { loadStateErrorResponse } from '@/lib/adapters/load-state-response.ts'
import { loadOverviewWindow } from '@/lib/adapters/overview.ts'

import type { APIRoute } from 'astro'
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

/**
 * Success body the island reads: the bare `OverviewWindow`, NOT the `apiErr`
 * `{ ok, ... }` envelope the error paths use via `jsonResponse`. The island
 * deserialises this window straight into its atoms, so success stays unwrapped;
 * only errors carry the envelope. Same split as `okLogsResponse` in api/logs.ts.
 */
const okOverviewResponse = (window: OverviewWindow): Response =>
	new Response(JSON.stringify(window), {
		status: HTTP_STATUS.OK,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	})

/**
 * The pure request handler, separated from the Astro `GET` wiring so it can be
 * driven by a plain `URL` in tests (no `APIContext` fake, no cast).
 */
export const handleOverviewRequest = async (url: URL): Promise<Response> => {
	const range = url.searchParams.get('range') ?? DEFAULT_RANGE
	const state = await loadPageState('api.overview', () =>
		loadOverviewWindow(range),
	)
	return state.kind === 'ok'
		? okOverviewResponse(state.data)
		: loadStateErrorResponse(state)
}

export const GET: APIRoute = ({ url }) => handleOverviewRequest(url)
