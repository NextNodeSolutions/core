import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { loadPageState } from '@/lib/adapters/load-page-state.ts'

import type { SdTargetGroup } from '@/lib/domain/monitoring/sd-targets.ts'

/**
 * Runner for the Prometheus http_sd endpoints: the contract is a BARE
 * JSON array of target groups (no {ok,data} envelope - vmagent would
 * reject it). Any failure surfaces as a plain 500: vmagent keeps its
 * previous target list on a non-200, which is exactly the degraded
 * behaviour we want when Tailscale or R2 hiccup.
 */
export const runSdEndpoint = async (
	scope: string,
	fetcher: () => Promise<ReadonlyArray<SdTargetGroup>>,
): Promise<Response> => {
	const state = await loadPageState(scope, fetcher)
	if (state.kind === 'ok') {
		return new Response(JSON.stringify(state.data), {
			status: HTTP_STATUS.OK,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		})
	}
	return new Response(JSON.stringify({ error: state.message }), {
		status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	})
}
