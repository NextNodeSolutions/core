import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HetznerApiFailure } from '@/lib/adapters/hetzner/client.ts'

import type { CmpMetric } from '@/islands/fleet-cmp/metrics.ts'
import type { CmpLine } from '@/lib/domain/monitoring/cmp-line.ts'

/**
 * End-to-end of the /api/vps/[slug]/cmp endpoint: drive the fleet-comparison
 * fan-out (the IO seam) and assert on Response.status + parsed body. We never
 * assert adapter wiring directly - only the observable HTTP contract the island
 * reads: a valid metric -> `{ lines }`, an unknown metric -> 400 (no IO), an
 * upstream failure -> 502 (never a silent empty 200).
 */

const loadFleetCmpMock =
	vi.fn<
		(metric: CmpMetric, hours: number) => Promise<ReadonlyArray<CmpLine>>
	>()

vi.mock('@/lib/adapters/victoria/fleet-cmp.ts', () => ({
	loadFleetCmp: (metric: CmpMetric, hours: number) =>
		loadFleetCmpMock(metric, hours),
}))

const { handleCmpRequest } = await import('@/pages/api/vps/[slug]/cmp.ts')

const buildUrl = (search: string): URL =>
	new URL(`http://monitoring.test/api/vps/stylot/cmp${search}`)

beforeEach(() => {
	loadFleetCmpMock.mockReset()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('GET /api/vps/[slug]/cmp', () => {
	it('returns the per-peer lines as JSON for a valid metric', async () => {
		const lines: ReadonlyArray<CmpLine> = [
			{ name: 'stylot', values: [10, 20, 30] },
			{ name: 'edge-1', values: [5, 6, 7] },
		]
		loadFleetCmpMock.mockResolvedValue(lines)

		const response = await handleCmpRequest(
			'stylot',
			buildUrl('?metric=mem'),
		)
		const body: unknown = await response.json()

		expect(response.status).toBe(200)
		expect(body).toEqual({ lines })
		// The validated metric reached the loader unchanged.
		expect(loadFleetCmpMock).toHaveBeenCalledWith('mem', expect.any(Number))
	})

	it('rejects an unknown metric with 400 and never touches the upstream', async () => {
		const response = await handleCmpRequest(
			'stylot',
			buildUrl('?metric=bogus'),
		)
		const body: unknown = await response.json()

		expect(response.status).toBe(400)
		expect(body).toMatchObject({ ok: false, code: 'bad_request' })
		expect(loadFleetCmpMock).not.toHaveBeenCalled()
	})

	it('maps an upstream fan-out failure to 502, not a silent empty 200', async () => {
		loadFleetCmpMock.mockRejectedValue(
			new HetznerApiFailure(
				'hetzner servers list',
				503,
				'fleet list down',
			),
		)

		const response = await handleCmpRequest(
			'stylot',
			buildUrl('?metric=cpu'),
		)
		const body: unknown = await response.json()

		expect(response.status).toBe(502)
		expect(body).toMatchObject({ ok: false, code: 'upstream_error' })
	})

	it('defaults to the cpu metric when none is provided', async () => {
		loadFleetCmpMock.mockResolvedValue([])

		const response = await handleCmpRequest('stylot', buildUrl(''))

		expect(response.status).toBe(200)
		expect(loadFleetCmpMock).toHaveBeenCalledWith('cpu', expect.any(Number))
	})
})
