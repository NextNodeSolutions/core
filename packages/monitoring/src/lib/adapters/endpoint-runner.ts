import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { jsonResponse } from '@/lib/adapters/json-response.ts'
import { loadPageState } from '@/lib/adapters/load-page-state.ts'
import { loadStateErrorResponse } from '@/lib/adapters/load-state-response.ts'
import { apiOk } from '@/lib/domain/api-result.ts'

export const runListEndpoint = async <T>(
	scope: string,
	fetcher: () => Promise<T>,
): Promise<Response> => {
	const state = await loadPageState(scope, fetcher)
	if (state.kind === 'ok') {
		return jsonResponse(apiOk(state.data), HTTP_STATUS.OK)
	}
	return loadStateErrorResponse(state)
}
