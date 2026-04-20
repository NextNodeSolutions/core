import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { jsonResponse } from '@/lib/adapters/json-response.ts'
import { loadPageState } from '@/lib/adapters/load-page-state.ts'
import { apiErr, apiOk } from '@/lib/domain/api-result.ts'

export const runListEndpoint = async <T>(
	scope: string,
	fetcher: () => Promise<T>,
): Promise<Response> => {
	const state = await loadPageState(scope, fetcher)
	switch (state.kind) {
		case 'ok':
			return jsonResponse(apiOk(state.data), HTTP_STATUS.OK)
		case 'missing_config':
			return jsonResponse(
				apiErr('missing_config', state.message),
				HTTP_STATUS.INTERNAL_SERVER_ERROR,
			)
		case 'upstream_error':
			return jsonResponse(
				apiErr('upstream_error', state.message),
				HTTP_STATUS.BAD_GATEWAY,
			)
		case 'internal_error':
			return jsonResponse(
				apiErr('internal_error', state.message),
				HTTP_STATUS.INTERNAL_SERVER_ERROR,
			)
	}
}
