import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LogsExplorer } from '@/islands/logs/LogsExplorer.tsx'

import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * Behavioural tests for the dynamic logs island. Every assertion checks what
 * the operator sees (rows, panel content, fetch URL) after a real interaction -
 * never internal atom state. The seeded initial logs come from props (no
 * fetch), so only the range-change case touches the network, which we stub.
 */

// A fixed clock so histogram bucketing is deterministic across machines. All
// fixtures sit inside the 6h window before this instant.
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

// The data region suspends on its first render until the seeded logs resolve;
// React 19 requires that initial suspend to be flushed inside an awaited `act`,
// so the helper is async. After it resolves the seeded rows are on screen.
const renderExplorer = async (
	logs: ReadonlyArray<LogLine> = SEED_LOGS,
	range = '6h',
): Promise<void> => {
	await act(async () => {
		render(
			<LogsExplorer
				initialLogs={logs}
				initialRange={range}
				nowMs={NOW_MS}
			/>,
		)
	})
}

// Rows render as buttons whose accessible name is the concatenated row text;
// matching on the message keeps the query resilient to the time/level columns.
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
		// The seeded initial range must paint from props alone.
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it('isolates to a level from the default, then adds a second level (isolate-then-additive)', async () => {
		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		const errorChip = screen.getByRole('button', { name: 'niveau error' })
		// The chip shows the per-level count for `error` (one error line seeded).
		expect(errorChip.textContent).toContain('1')

		// From the all-active default, clicking ERROR ISOLATES to errors: the
		// error row stays, the info/warn rows vanish - clicking a level SHOWS it
		// rather than hiding it. The null-level row always passes the chip filter.
		await user.click(errorChip)
		await waitFor(() => expect(queryRow('user signed in')).toBeNull())
		expect(queryRow('disk almost full')).toBeNull()
		expect(queryRow('unhandled exception in handler')).not.toBeNull()
		expect(queryRow('cron tick')).not.toBeNull()

		// Clicking WARN is additive: now ERROR + WARN rows are both visible.
		await user.click(screen.getByRole('button', { name: 'niveau warn' }))
		expect(await findRow('disk almost full')).toBeDefined()
		expect(queryRow('unhandled exception in handler')).not.toBeNull()
		expect(queryRow('user signed in')).toBeNull()
	})

	it('resets to all levels when the last active level is removed (never blanks)', async () => {
		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		// Isolate to error, then remove it: the empty set snaps back to "all", so
		// every level is shown again instead of leaving a dead screen.
		await user.click(screen.getByRole('button', { name: 'niveau error' }))
		await waitFor(() => expect(queryRow('user signed in')).toBeNull())

		await user.click(screen.getByRole('button', { name: 'niveau error' }))
		expect(await findRow('user signed in')).toBeDefined()
		expect(queryRow('disk almost full')).not.toBeNull()
		expect(queryRow('unhandled exception in handler')).not.toBeNull()
	})

	it('filters rows by the search query (message / path / service / trace)', async () => {
		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		await user.type(
			screen.getByLabelText('Rechercher dans les logs'),
			'disk',
		)

		await waitFor(() => expect(queryRow('user signed in')).toBeNull())
		expect(queryRow('disk almost full')).not.toBeNull()
		expect(queryRow('unhandled exception in handler')).toBeNull()
	})

	it('narrows rows by the service facet', async () => {
		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		await user.selectOptions(
			screen.getByLabelText('Filtrer par service'),
			'worker',
		)

		await waitFor(() => expect(queryRow('user signed in')).toBeNull())
		expect(queryRow('disk almost full')).not.toBeNull()
	})

	it('narrows rows by the vps facet', async () => {
		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		await user.selectOptions(
			screen.getByLabelText('Filtrer par VPS'),
			'edge-1',
		)

		await waitFor(() => expect(queryRow('user signed in')).toBeNull())
		expect(queryRow('unhandled exception in handler')).not.toBeNull()
		expect(queryRow('cron tick')).not.toBeNull()
	})

	it('opens the detail panel with the clicked log and closes it - no navigation', async () => {
		const user = userEvent.setup()
		const hrefBefore = window.location.href
		await renderExplorer()

		// This row carries a request line, a status, and a meta context entry.
		await user.click(await findRow('user signed in'))

		// The panel is populated with THAT log's fields. The request line splits
		// method + path across text nodes, so match on the path substring.
		expect(await screen.findByText('Requête')).toBeDefined()
		expect(screen.getByText(/\/api\/session/)).toBeDefined()
		expect(screen.getByText('Contexte')).toBeDefined()
		expect(screen.getByText('requestId')).toBeDefined()

		// A different log's content is NOT shown (no stack on this row).
		expect(screen.queryByText('Stack trace')).toBeNull()

		// Closing clears the panel.
		await user.click(
			screen.getByRole('button', { name: 'Fermer le détail' }),
		)
		await waitFor(() => expect(screen.queryByText('Requête')).toBeNull())

		// Selection is pure client state: the URL never changed.
		expect(window.location.href).toBe(hrefBefore)
	})

	it('shows the empty state when no row matches the filters', async () => {
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
				new Response(JSON.stringify({ logs: [liveLine] }), {
					status: 200,
				}),
			),
		)
		vi.stubGlobal('fetch', fetchSpy)

		const user = userEvent.setup()
		await renderExplorer()
		await findRow('user signed in')

		// The Live tab is a cold range: the click triggers a fetch and the data
		// region suspends to the skeleton until the fetch resolves.
		await user.click(screen.getByRole('tab', { name: /Live/i }))

		// The list swaps to the freshly-fetched window...
		expect(await findRow('fresh live event')).toBeDefined()
		expect(queryRow('user signed in')).toBeNull()

		// ...via a single request to the live (1h) window.
		expect(fetchSpy).toHaveBeenCalledWith('/api/logs?range=live')

		// The filter controls stayed mounted/usable through the suspended reload.
		expect(screen.getByLabelText('Rechercher dans les logs')).toBeDefined()
		expect(screen.getByLabelText('Filtrer par service')).toBeDefined()
	})
})
