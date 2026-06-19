import { useState } from 'react'

import { createStore, Provider } from 'jotai'

import { rangeAtom, seedAtom } from '@/islands/overview/atoms.ts'
import { OverviewScreen } from '@/islands/overview/OverviewScreen.tsx'

import type { OverviewWindow } from '@/lib/domain/monitoring/overview.ts'

/**
 * Root of the dynamic overview island. Builds a private Jotai store ONCE per
 * mount and seeds it (the server-computed initial window + its range) BEFORE
 * any child reads an atom - so the initial range paints from server data with
 * no fetch and no loading flash. Seeding via the store (not useHydrateAtoms)
 * avoids the hydrate-after-first-read race that would otherwise leave the data
 * region suspended forever. Mounted in index.astro with `client:load`.
 */

interface OverviewProps {
	readonly seed: OverviewWindow
}

export function Overview({ seed }: OverviewProps): React.ReactElement {
	const [store] = useState(() => {
		const seeded = createStore()
		seeded.set(seedAtom, seed)
		seeded.set(rangeAtom, seed.range)
		return seeded
	})

	return (
		<Provider store={store}>
			<OverviewScreen />
		</Provider>
	)
}
