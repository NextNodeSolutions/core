import { HTTP_STATUS } from '@/lib/adapters/http-status.ts'
import { loadPageState } from '@/lib/adapters/load-page-state.ts'

// The Prometheus text-exposition format version vmagent negotiates. A scraper
// that gets a different content-type (or an envelope) drops the whole scrape,
// so this string is a contract - centralised here, mirroring runSdEndpoint.
const PROMETHEUS_EXPOSITION_CONTENT_TYPE = 'text/plain; version=0.0.4'

/**
 * Runner for a Prometheus text-exposition endpoint: a successful render is
 * served as `text/plain; version=0.0.4`; any failure is a plain 500 so the
 * scraper keeps its previous samples rather than ingesting an error body.
 */
export const runExpositionEndpoint = async (
	scope: string,
	render: () => Promise<string>,
): Promise<Response> => {
	const state = await loadPageState(scope, render)
	if (state.kind === 'ok') {
		return new Response(state.data, {
			status: HTTP_STATUS.OK,
			headers: { 'content-type': PROMETHEUS_EXPOSITION_CONTENT_TYPE },
		})
	}
	return new Response(state.message, {
		status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
		headers: { 'content-type': 'text/plain' },
	})
}
