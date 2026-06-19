import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OverviewWindow } from '@/lib/domain/monitoring/overview.ts'

/**
 * End-to-end of the /api/overview endpoint: drive the window loader (the IO
 * seam) and assert on Response.status + parsed body. The contract the island
 * reads: a loaded window -> 200 with `{ stats, stream, notices }` (a degraded
 * upstream rides along in `notices`, never a silent empty success); an
 * unexpected assembly failure -> 5xx.
 */

const loadOverviewWindowMock =
	vi.fn<(range: string) => Promise<OverviewWindow>>()

vi.mock('@/lib/adapters/overview.ts', () => ({
	loadOverviewWindow: (range: string) => loadOverviewWindowMock(range),
}))

const { handleOverviewRequest } = await import('@/pages/api/overview.ts')

const buildUrl = (search: string): URL =>
	new URL(`http://monitoring.test/api/overview${search}`)

const WINDOW: OverviewWindow = {
	range: 'live',
	windowHours: 1,
	stats: [
		{
			label: 'VPS actifs',
			value: '2/2',
			hint: 'ok',
			tone: 'positive',
			icon: 'server',
		},
	],
	stream: [],
	notices: [{ section: 'logs', label: 'VictoriaLogs', message: 'HTTP 0' }],
}

beforeEach(() => {
	loadOverviewWindowMock.mockReset()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('GET /api/overview', () => {
	it('returns the loaded window as JSON, notices included', async () => {
		loadOverviewWindowMock.mockResolvedValue(WINDOW)

		const response = await handleOverviewRequest(buildUrl('?range=live'))
		const body: unknown = await response.json()

		expect(response.status).toBe(200)
		expect(body).toEqual(WINDOW)
		// A degraded upstream surfaces as a notice on a 200, never a silent empty.
		expect(loadOverviewWindowMock).toHaveBeenCalledWith('live')
	})

	it('defaults to the live window when no range is provided', async () => {
		loadOverviewWindowMock.mockResolvedValue(WINDOW)

		const response = await handleOverviewRequest(buildUrl(''))

		expect(response.status).toBe(200)
		expect(loadOverviewWindowMock).toHaveBeenCalledWith('live')
	})

	it('maps an unexpected assembly failure to 500, not an empty 200', async () => {
		loadOverviewWindowMock.mockRejectedValue(new Error('assembly blew up'))

		const response = await handleOverviewRequest(buildUrl('?range=6h'))
		const body: unknown = await response.json()

		expect(response.status).toBe(500)
		expect(body).toMatchObject({ ok: false, code: 'internal_error' })
	})
})
