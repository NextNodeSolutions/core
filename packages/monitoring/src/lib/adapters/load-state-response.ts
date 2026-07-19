import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { jsonResponse } from '@/lib/adapters/json-response.ts'
import { apiErr } from '@/lib/domain/api-result.ts'

import type { LoadState } from '@/lib/domain/load-state.ts'

/**
 * The ONE mapping from a non-ok `LoadState` to its API error response:
 * upstream down -> 502, missing config / unexpected failure -> 500, each with
 * the matching `apiErr` code. Routes keep only their own success shape and
 * delegate every failure here - this switch used to be copied verbatim in
 * api/logs.ts, api/overview.ts, api/vps/[slug]/cmp.ts, api/vps/[slug]/
 * metrics.ts and endpoint-runner.ts.
 */
export const loadStateErrorResponse = (
	state: Exclude<LoadState<unknown>, { kind: 'ok' }>,
): Response => {
	switch (state.kind) {
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
