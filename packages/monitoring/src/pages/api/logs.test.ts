import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleLogsRequest } from '@/pages/api/logs.ts'

/**
 * End-to-end of the /api/logs endpoint: stub the VictoriaLogs fetch, call the
 * request handler, assert on Response.status + parsed body. We never assert the
 * adapter wiring directly - only the observable HTTP contract the island reads.
 */

const buildUrl = (search: string): URL =>
	new URL(`http://monitoring.test/api/logs${search}`)

// The VictoriaLogs client calls `fetch` with a string URL, so the stub reads
// the requested URL straight off that argument.
const stubVictoriaResponse = (handler: (url: string) => Response): void => {
	vi.stubGlobal('fetch', (input: string) => Promise.resolve(handler(input)))
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('GET /api/logs', () => {
	it('returns the parsed fleet logs as JSON on success', async () => {
		const ndjson = JSON.stringify({
			_time: '2026-06-15T10:00:00.000Z',
			_msg: '{"level":"info","message":"server started"}',
			message: 'server started',
			level: 'info',
			nn_service: 'app',
			nn_project: 'stylot',
			container_name: 'stylot-production-app-1',
		})
		stubVictoriaResponse(() => new Response(ndjson, { status: 200 }))

		const response = await handleLogsRequest(buildUrl('?range=6h'))
		const body: unknown = await response.json()

		expect(response.status).toBe(200)
		// The body now carries the line sample AND the windowed stats. This stub
		// returns the same log line for every query, so the stats query (which
		// expects `hits` rows) finds none -> an honest empty aggregate.
		expect(body).toMatchObject({
			logs: [
				expect.objectContaining({
					message: 'server started',
					level: 'info',
					service: 'app',
					vps: 'stylot',
				}),
			],
			stats: { total: 0, levelCounts: { error: 0 } },
			// Facet dropdown values come from the `uniq by (...)` queries.
			facets: { services: ['app'], vps: ['stylot'] },
		})
	})

	it('threads the service/vps/search facets into the LogsQL queries', async () => {
		const queried: string[] = []
		stubVictoriaResponse(url => {
			queried.push(url)
			return new Response('', { status: 200 })
		})

		await handleLogsRequest(
			buildUrl('?range=6h&service=app&vps=nn-prod&q=boom'),
		)

		// The sample + stats queries carry the facet/search scope (URL-encoded).
		const scoped = queried.filter(
			url =>
				url.includes('nn_project%3A%22nn-prod%22') &&
				url.includes('nn_service%3A%22app%22'),
		)
		expect(scoped.length).toBeGreaterThanOrEqual(2)
		expect(queried.some(url => url.includes('boom'))).toBe(true)
	})

	it('maps an upstream VictoriaLogs failure to 502, not a silent empty 200', async () => {
		stubVictoriaResponse(
			() => new Response('victorialogs down', { status: 503 }),
		)

		const response = await handleLogsRequest(buildUrl('?range=1h'))
		const body: unknown = await response.json()

		expect(response.status).toBe(502)
		expect(body).toMatchObject({ ok: false, code: 'upstream_error' })
	})

	it('defaults to the 6h window when range is absent', async () => {
		const queried: string[] = []
		stubVictoriaResponse(url => {
			queried.push(url)
			return new Response('', { status: 200 })
		})

		const response = await handleLogsRequest(buildUrl(''))

		expect(response.status).toBe(200)
		// The fleet query embeds the window as `_time:6h` - the default range.
		expect(queried.some(url => url.includes('_time%3A6h'))).toBe(true)
	})

	it('maps the live range to a short 5-minute window (not 1h history)', async () => {
		const queried: string[] = []
		stubVictoriaResponse(url => {
			queried.push(url)
			return new Response('', { status: 200 })
		})

		await handleLogsRequest(buildUrl('?range=live'))

		// `_time:5m`, never `_time:1h` - live is a recent window, not a 1h history.
		expect(queried.some(url => url.includes('_time%3A5m'))).toBe(true)
		expect(queried.some(url => url.includes('_time%3A1h'))).toBe(false)
	})
})
