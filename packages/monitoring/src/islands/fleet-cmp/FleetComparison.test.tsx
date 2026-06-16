import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FleetComparison } from '@/islands/fleet-cmp/FleetComparison.tsx'

import type { CmpLine } from '@/lib/domain/monitoring/cmp-line.ts'

/**
 * Behavioural tests for the dynamic fleet-comparison island. Every assertion
 * checks what the operator sees (legend peers, the `(actuel)` marker, the fetch
 * URL) after a real interaction - never internal atom state. The seeded cpu
 * lines come from props (no fetch); only a metric change touches the network,
 * which we stub. The seeded fleet and each metric's fetched fleet carry a
 * DIFFERENT peer so the chart/legend swap is observable by peer name.
 */

const SEED_CPU: ReadonlyArray<CmpLine> = [
	{ name: 'stylot', values: [10, 20, 30] },
	{ name: 'edge-cpu', values: [40, 50, 60] },
]

const MEM_LINES: ReadonlyArray<CmpLine> = [
	{ name: 'stylot', values: [70, 60, 50] },
	{ name: 'edge-mem', values: [11, 12, 13] },
]

// The data region suspends on its first render until the seeded lines resolve;
// React 19 requires that initial suspend to be flushed inside an awaited `act`,
// so the helper is async. After it resolves the seeded legend is on screen.
const renderPanel = async (): Promise<void> => {
	await act(async () => {
		render(
			<FleetComparison
				slug="stylot"
				range="6h"
				initialLines={SEED_CPU}
			/>,
		)
	})
}

const stubMemFetch = (): ReturnType<typeof vi.fn> => {
	const fetchSpy = vi.fn(() =>
		Promise.resolve(
			new Response(JSON.stringify({ lines: MEM_LINES }), { status: 200 }),
		),
	)
	vi.stubGlobal('fetch', fetchSpy)
	return fetchSpy
}

const clickTab = (label: string): Promise<void> =>
	userEvent.setup().click(screen.getByRole('tab', { name: label }))

beforeEach(() => {
	vi.unstubAllGlobals()
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('FleetComparison island', () => {
	it('renders the seeded cpu comparison on first paint without any fetch', async () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal('fetch', fetchSpy)

		await renderPanel()

		expect(await screen.findByText('edge-cpu')).toBeDefined()
		expect(screen.getByText('stylot')).toBeDefined()
		// The seeded initial metric must paint from props alone.
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it('marks the current slug entry as (actuel) and not the peers', async () => {
		vi.stubGlobal('fetch', vi.fn())
		await renderPanel()
		await screen.findByText('edge-cpu')

		// Only the current host carries the marker.
		const markers = screen.getAllByText('(actuel)')
		expect(markers).toHaveLength(1)
		// The marker sits in the current host's chip, alongside its name.
		expect(markers[0]?.parentElement?.textContent).toContain('stylot')
		// ...and NOT in a peer's chip.
		expect(markers[0]?.parentElement?.textContent).not.toContain('edge-cpu')
	})

	it('fetches the mem series once on a tab click and swaps the legend while tabs stay live', async () => {
		const fetchSpy = stubMemFetch()
		await renderPanel()
		await screen.findByText('edge-cpu')

		// Clicking Mémoire is a cold metric: the region suspends, fetches once,
		// then the legend swaps to the mem fleet.
		await clickTab('Mémoire')

		expect(await screen.findByText('edge-mem')).toBeDefined()
		await waitFor(() => expect(screen.queryByText('edge-cpu')).toBeNull())

		// Exactly one request, to the mem metric for this slug.
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(fetchSpy).toHaveBeenCalledWith(
			'/api/vps/stylot/cmp?metric=mem&range=6h',
		)

		// The tabs stayed mounted and interactive through the suspended reload.
		expect(screen.getByRole('tab', { name: 'CPU' })).toBeDefined()
		expect(screen.getByRole('tab', { name: 'Load' })).toBeDefined()
	})

	it('does not refetch when switching back to an already-loaded metric', async () => {
		const fetchSpy = stubMemFetch()
		await renderPanel()
		await screen.findByText('edge-cpu')

		await clickTab('Mémoire')
		await screen.findByText('edge-mem')
		expect(fetchSpy).toHaveBeenCalledTimes(1)

		// Back to cpu: seeded (never fetched). Forward to mem again: cached.
		await clickTab('CPU')
		expect(await screen.findByText('edge-cpu')).toBeDefined()
		await clickTab('Mémoire')
		expect(await screen.findByText('edge-mem')).toBeDefined()

		// Still a single network call across all the swaps.
		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})
})
