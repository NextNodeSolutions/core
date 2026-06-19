import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Overview } from '@/islands/overview/Overview.tsx'

import type { OverviewWindow } from '@/lib/domain/monitoring/overview.ts'

/**
 * Behavioural tests for the dynamic overview island. Assertions check what the
 * operator sees (stat labels, stream rows, the elevated critical card, the
 * fetch URL) after a real interaction. The seeded initial window comes from
 * props (no fetch); only the range-change case touches the network, stubbed.
 */

const SEED: OverviewWindow = {
	range: '6h',
	windowHours: 6,
	stats: [
		{
			label: 'VPS actifs',
			value: '2/2',
			hint: 'Tous opérationnels',
			tone: 'positive',
			icon: 'server',
		},
		{
			label: 'CPU moyen (6 h)',
			value: '42%',
			hint: '2 nœuds',
			tone: 'neutral',
			icon: 'cpu',
		},
		{
			label: 'Trafic sortant (mois)',
			value: '921 MB',
			hint: 'sur 43 TB inclus',
			tone: 'neutral',
			icon: 'net',
		},
		{
			label: 'Erreurs (6 h)',
			value: '3',
			hint: '1 alerte',
			tone: 'danger',
			icon: 'alert',
		},
	],
	stream: [
		{
			key: '0:a',
			time: '10:00:00',
			level: 'error',
			service: 'api',
			message: 'boom happened',
		},
		{
			key: '1:b',
			time: '09:59:00',
			level: 'info',
			service: 'app',
			message: 'user signed in',
		},
	],
	notices: [],
}

const renderOverview = async (seed: OverviewWindow = SEED): Promise<void> => {
	await act(async () => {
		render(<Overview seed={seed} />)
	})
}

beforeEach(() => {
	vi.unstubAllGlobals()
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('Overview island', () => {
	it('paints the seeded stats, stream and range tabs without any fetch', async () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal('fetch', fetchSpy)

		await renderOverview()

		expect(await screen.findByText('VPS actifs')).toBeDefined()
		expect(screen.getByText('Erreurs (6 h)')).toBeDefined()
		expect(screen.getByText('boom happened')).toBeDefined()
		expect(screen.getByRole('tab', { name: /6h/i })).toBeDefined()
		// The seeded initial range must paint from props alone.
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it('elevates a critical (danger) stat to a wide card, sorted first', async () => {
		const { container } = await actRender()

		const errorsCard = screen.getByText('Erreurs (6 h)').closest('article')
		expect(errorsCard).not.toBeNull()
		// Criticality drives BOTH the wider span and the red surface.
		expect(errorsCard?.className).toContain('col-span-2')
		expect(errorsCard?.className).toContain('bg-red-50')

		// A nominal stat stays one column.
		const cpuCard = screen.getByText('CPU moyen (6 h)').closest('article')
		expect(cpuCard?.className).not.toContain('col-span-2')

		// The elevated card leads, so a 2-col card never opens a mid-row hole.
		const firstCard = container.querySelector('article')
		expect(firstCard?.textContent).toContain('Erreurs (6 h)')
	})

	it('surfaces a degraded-upstream notice from the window', async () => {
		await renderOverview({
			...SEED,
			notices: [
				{
					section: 'logs',
					label: 'VictoriaLogs',
					message: 'query: HTTP 0',
				},
			],
		})
		expect(await screen.findByText('VictoriaLogs')).toBeDefined()
		expect(screen.getByText('query: HTTP 0')).toBeDefined()
	})

	it('fetches /api/overview on a range change and swaps the stats live', async () => {
		const liveWindow: OverviewWindow = {
			range: 'live',
			windowHours: 1,
			stats: [
				{
					label: 'CPU moyen (1 h)',
					value: '7%',
					hint: '2 nœuds',
					tone: 'neutral',
					icon: 'cpu',
				},
			],
			stream: [],
			notices: [],
		}
		const fetchSpy = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify(liveWindow), { status: 200 }),
			),
		)
		vi.stubGlobal('fetch', fetchSpy)

		const user = userEvent.setup()
		await renderOverview()
		await screen.findByText('Erreurs (6 h)')

		// Live is a cold range: the click triggers a fetch; the data region
		// suspends to the skeleton until it resolves, then the stats swap.
		await user.click(screen.getByRole('tab', { name: /Live/i }))

		expect(await screen.findByText('CPU moyen (1 h)')).toBeDefined()
		await waitFor(() =>
			expect(screen.queryByText('Erreurs (6 h)')).toBeNull(),
		)
		expect(fetchSpy).toHaveBeenCalledWith('/api/overview?range=live')

		// The range tabs stayed mounted through the suspended reload.
		expect(screen.getByRole('tab', { name: /6h/i })).toBeDefined()
	})
})

// Render variant that returns the container for DOM-order / layout assertions.
const actRender = async (): Promise<{ container: HTMLElement }> => {
	let rendered: { container: HTMLElement } | null = null
	await act(async () => {
		rendered = render(<Overview seed={SEED} />)
	})
	if (rendered === null) throw new Error('render did not complete')
	return rendered
}
