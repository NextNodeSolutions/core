import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadFleetLogs } from '@/lib/adapters/victoria/logs.ts'

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

const decodedQuery = (url: string): string => {
	const parsed = new URL(url)
	return parsed.searchParams.get('query') ?? ''
}

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('loadFleetLogs window clamping', () => {
	it('clamps a negative window to a safe positive bound before the LogsQL query', async () => {
		const probe = captureFetchUrl()

		await loadFleetLogs(-5)

		const query = decodedQuery(probe.lastUrl())
		expect(query).not.toContain('_time:-5h')
		expect(query).not.toContain('_time:-')
		expect(query).toMatch(/_time:\d+h/)
	})

	it('clamps a NaN window rather than emitting _time:NaNh', async () => {
		const probe = captureFetchUrl()

		await loadFleetLogs(Number.NaN)

		expect(decodedQuery(probe.lastUrl())).not.toContain('NaN')
	})
})
