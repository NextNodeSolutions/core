import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadVpsSeries } from '@/lib/adapters/victoria/metrics.ts'

const EMPTY_ENVELOPE = JSON.stringify({ data: { result: [] } })

const captureFetchUrl = (): { lastUrl: () => string } => {
	let captured = ''
	vi.stubGlobal(
		'fetch',
		vi.fn((url: string) => {
			captured = url
			return Promise.resolve(
				new Response(EMPTY_ENVELOPE, { status: 200 }),
			)
		}),
	)
	return { lastUrl: () => captured }
}

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('loadVpsSeries window clamping', () => {
	it('clamps a NaN hours window so the range step is a finite integer', async () => {
		const probe = captureFetchUrl()

		await loadVpsSeries('vps-1', 'cpu', Number.NaN)

		const parsed = new URL(probe.lastUrl())
		const step = Number(parsed.searchParams.get('step'))
		const start = Number(parsed.searchParams.get('start'))
		expect(Number.isInteger(step)).toBe(true)
		expect(step).toBeGreaterThan(0)
		expect(Number.isFinite(start)).toBe(true)
	})
})
