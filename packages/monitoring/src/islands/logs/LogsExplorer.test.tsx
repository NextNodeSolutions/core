import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LogsExplorer } from '@/islands/logs/LogsExplorer.tsx'
import {
	fleetStatsFromLogs,
	windowMsFor,
} from '@/lib/domain/monitoring/log-aggregates.ts'
import { rangeToHours } from '@/lib/domain/monitoring/vps-metrics.ts'

import type { FleetLogStats } from '@/lib/domain/monitoring/log-aggregates.ts'
import type { LogFacets, LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * Behavioural tests for the dynamic logs island. Every assertion checks what
 * the operator sees (rows, panel, fetch URL) after a real interaction. The
 * SERVER does the windowing + facet/search filtering, so a facet select or a
 * (debounced) search re-keys a fetch (stubbed here); the LEVEL chips remain a
 * client-side refinement of the seeded sample (no fetch). The seeded initial
 * range paints from props with no fetch.
 */

const NOW_MS = Date.parse('2026-06-15T12:00:00.000Z')

const buildLine = (overrides: Partial<LogLine>): LogLine => ({
	time: '2026-06-15T11:59:00.000Z',
	message: 'baseline message',
	container: null,
	level: 'info',
	service: 'app',
	vps: 'stylot',
	status: null,
	method: null,
	path: null,
	durationMs: null,
	traceId: null,
	stack: null,
	meta: {},
	...overrides,
})

const SEED_LOGS: ReadonlyArray<LogLine> = [
	buildLine({
		message: 'user signed in',
		level: 'info',
		service: 'app',
		vps: 'stylot',
		method: 'POST',
		path: '/api/session',
		status: 200,
		traceId: 'abc123def456',
		meta: { requestId: 'req-1' },
	}),
	buildLine({
		message: 'disk almost full',
		level: 'warn',
		service: 'worker',
		vps: 'stylot',
	}),
	buildLine({
		message: 'unhandled exception in handler',
		level: 'error',
		service: 'api',
		vps: 'edge-1',
		status: 500,
		stack: 'Error: boom\n  at handler (x.ts:1)',
	}),
	buildLine({
		message: 'cron tick',
		level: null,
		service: 'app',
		vps: 'edge-1',
	}),
]

const sorted = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
	[...new Set(values)].toSorted((a, b) => a.localeCompare(b))

const facetsFor = (logs: ReadonlyArray<LogLine>): LogFacets => ({
	services: sorted(
		logs
			.map(line => line.service)
			.filter((name): name is string => name !== null),
	),
	vps: sorted(
		logs
			.map(line => line.vps)
			.filter((name): name is string => name !== null),
	),
})

const statsFor = (logs: ReadonlyArray<LogLine>, range: string): FleetLogStats =>
	fleetStatsFromLogs(logs, {
		nowMs: NOW_MS,
		windowMs: windowMsFor(rangeToHours(range)),
	})

// The {logs, stats, facets} body /api/logs returns for a given (filtered) set.
const windowBody = (logs: ReadonlyArray<LogLine>, range: string): string =>
	JSON.stringify({
		logs,
		stats: statsFor(logs, range),
		facets: facetsFor(SEED_LOGS), // dropdowns keep the full window's values
	})

// The data region suspends on its first render until the seeded logs resolve;
// React 19 requires that initial suspend to be flushed inside an awaited `act`.
const renderExplorer = async (
	logs: ReadonlyArray<LogLine> = SEED_LOGS,
	range = '6h',
): Promise<void> => {
	await act(async () => {
		render(
			<LogsExplorer
				initialLogs={logs}
				initialStats={statsFor(logs, range)}
				initialFacets={facetsFor(logs)}
				initialRange={range}
			/>,
		)
	})
}

const findRow = (message: string): Promise<HTMLElement> =>
	screen.findByRole('button', { name: new RegExp(message, 'i') })

const queryRow = (message: string): HTMLElement | null =>
	screen.queryByRole('button', { name: new RegExp(message, 'i') })

beforeEach(() => {
	vi.unstubAllGlobals()
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('LogsExplorer island', () => {
	it('renders the seeded rows on first paint without any fetch', async () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal('fetch', fetchSpy)

		await renderExplorer()

		expect(await findRow('user signed in')).toBeDefined()
		expect(queryRow('unhandled exception in handler')).not.toBeNull()
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it('isolates to a level CLIENT-side from the seed, no fetch', async () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal('fetch', fetchSpy)
		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		const errorChip = screen.getByRole('button', { name: 'niveau error' })
		// Chip count is the windowed per-level tally from the seeded stats.
		expect(errorChip.textContent).toContain('1')

		// Clicking ERROR isolates the LIST to errors with NO network (level is a
		// client refinement); the null-level row always passes the chip filter.
		await user.click(errorChip)
		await waitFor(() => expect(queryRow('user signed in')).toBeNull())
		expect(queryRow('disk almost full')).toBeNull()
		expect(queryRow('unhandled exception in handler')).not.toBeNull()
		expect(queryRow('cron tick')).not.toBeNull()
		expect(fetchSpy).not.toHaveBeenCalled()

		// WARN is additive: ERROR + WARN rows both visible.
		await user.click(screen.getByRole('button', { name: 'niveau warn' }))
		expect(await findRow('disk almost full')).toBeDefined()
		expect(queryRow('user signed in')).toBeNull()
	})

	it('resets to all levels when the last active level is removed (client)', async () => {
		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		await user.click(screen.getByRole('button', { name: 'niveau error' }))
		await waitFor(() => expect(queryRow('user signed in')).toBeNull())

		await user.click(screen.getByRole('button', { name: 'niveau error' }))
		expect(await findRow('user signed in')).toBeDefined()
		expect(queryRow('disk almost full')).not.toBeNull()
	})

	it('narrows rows SERVER-side by the service facet (refetch)', async () => {
		const workerLine = buildLine({
			message: 'disk almost full',
			level: 'warn',
			service: 'worker',
			vps: 'stylot',
		})
		const fetchSpy = vi.fn(() =>
			Promise.resolve(
				new Response(windowBody([workerLine], '6h'), {
					status: 200,
				}),
			),
		)
		vi.stubGlobal('fetch', fetchSpy)
		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		await user.selectOptions(
			screen.getByLabelText('Filtrer par service'),
			'worker',
		)

		// The server returns only the worker line; the list swaps to it.
		expect(await findRow('disk almost full')).toBeDefined()
		await waitFor(() => expect(queryRow('user signed in')).toBeNull())
		// ...via a request carrying the service filter.
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining('service=worker'),
		)
	})

	it('narrows rows SERVER-side by the vps facet (refetch)', async () => {
		const edgeLine = buildLine({
			message: 'unhandled exception in handler',
			level: 'error',
			service: 'api',
			vps: 'edge-1',
		})
		const fetchSpy = vi.fn(() =>
			Promise.resolve(
				new Response(windowBody([edgeLine], '6h'), {
					status: 200,
				}),
			),
		)
		vi.stubGlobal('fetch', fetchSpy)
		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		await user.selectOptions(
			screen.getByLabelText('Filtrer par VPS'),
			'edge-1',
		)

		expect(await findRow('unhandled exception in handler')).toBeDefined()
		await waitFor(() => expect(queryRow('user signed in')).toBeNull())
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining('vps=edge-1'),
		)
	})

	it('searches SERVER-side after debouncing the input', async () => {
		const diskLine = buildLine({
			message: 'disk almost full',
			level: 'warn',
			service: 'worker',
			vps: 'stylot',
		})
		const fetchSpy = vi.fn(() =>
			Promise.resolve(
				new Response(windowBody([diskLine], '6h'), {
					status: 200,
				}),
			),
		)
		vi.stubGlobal('fetch', fetchSpy)
		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		await user.type(
			screen.getByLabelText('Rechercher dans les logs'),
			'disk',
		)

		// After the debounce settles, one request carries the search and the list
		// swaps to the server-filtered result.
		expect(await findRow('disk almost full')).toBeDefined()
		await waitFor(() =>
			expect(fetchSpy).toHaveBeenCalledWith(
				expect.stringContaining('q=disk'),
			),
		)
		expect(queryRow('unhandled exception in handler')).toBeNull()
	})

	it('opens the detail panel with the clicked log and closes it - no navigation', async () => {
		const user = userEvent.setup()
		const hrefBefore = window.location.href
		await renderExplorer()

		await user.click(await findRow('user signed in'))

		expect(await screen.findByText('Requête')).toBeDefined()
		expect(screen.getByText(/\/api\/session/)).toBeDefined()
		expect(screen.getByText('Contexte')).toBeDefined()
		expect(screen.getByText('requestId')).toBeDefined()
		expect(screen.queryByText('Stack trace')).toBeNull()

		await user.click(
			screen.getByRole('button', { name: 'Fermer le détail' }),
		)
		await waitFor(() => expect(screen.queryByText('Requête')).toBeNull())
		expect(window.location.href).toBe(hrefBefore)
	})

	it('shows the empty state when the server returns no matching rows', async () => {
		const fetchSpy = vi.fn(() =>
			Promise.resolve(
				new Response(windowBody([], '6h'), { status: 200 }),
			),
		)
		vi.stubGlobal('fetch', fetchSpy)
		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		await user.type(
			screen.getByLabelText('Rechercher dans les logs'),
			'no-such-log-anywhere',
		)

		expect(
			await screen.findByText('Aucun log ne correspond aux filtres.'),
		).toBeDefined()
	})

	it('fetches /api/logs on a range change and the list updates while controls stay live', async () => {
		const liveLine = buildLine({
			message: 'fresh live event',
			level: 'info',
			service: 'app',
			vps: 'stylot',
		})
		const fetchSpy = vi.fn(() =>
			Promise.resolve(
				new Response(windowBody([liveLine], 'live'), {
					status: 200,
				}),
			),
		)
		vi.stubGlobal('fetch', fetchSpy)

		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		await user.click(screen.getByRole('tab', { name: /Live/i }))

		expect(await findRow('fresh live event')).toBeDefined()
		expect(queryRow('user signed in')).toBeNull()
		// The live range carries no facet filters, so just the range param.
		expect(fetchSpy).toHaveBeenCalledWith('/api/logs?range=live')

		expect(screen.getByLabelText('Rechercher dans les logs')).toBeDefined()
		expect(screen.getByLabelText('Filtrer par service')).toBeDefined()
	})
})
