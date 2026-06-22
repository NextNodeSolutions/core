import { useState } from 'react'

import { createStore, Provider } from 'jotai'

import { rangeAtom, seedAtom } from '@/islands/logs/atoms.ts'
import { ExplorerScreen } from '@/islands/logs/ExplorerScreen.tsx'

import type { FleetLogStats } from '@/lib/domain/monitoring/log-aggregates.ts'
import type { LogLine } from '@/lib/domain/monitoring/log-query.ts'

/**
 * Root of the dynamic /logs island. It builds a private Jotai store ONCE per
 * mount and seeds it (the initial range's line sample + windowed stats) BEFORE
 * any child reads an atom - so the initial range paints from server data with
 * no fetch and no loading flash. Seeding via the store (not useHydrateAtoms)
 * avoids the hydrate-after-first-read race that would otherwise leave the data
 * region suspended forever. Mounted in logs/index.astro with `client:load`.
 */

interface LogsExplorerProps {
	readonly initialLogs: ReadonlyArray<LogLine>
	readonly initialStats: FleetLogStats
	readonly initialRange: string
}

export function LogsExplorer({
	initialLogs,
	initialStats,
	initialRange,
}: LogsExplorerProps): React.ReactElement {
	// `useState` initializer runs once: create + seed the store before render
	// reads it, without mutating anything React owns on re-render.
	const [store] = useState(() => {
		const seeded = createStore()
		seeded.set(seedAtom, {
			range: initialRange,
			logs: initialLogs,
			stats: initialStats,
		})
		seeded.set(rangeAtom, initialRange)
		return seeded
	})

	return (
		<Provider store={store}>
			<ExplorerScreen initialRange={initialRange} />
		</Provider>
	)
}
