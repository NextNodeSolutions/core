import { Suspense, useState } from 'react'

import { createStore, Provider } from 'jotai'

import {
	metricAtom,
	rangeAtom,
	seedAtom,
	slugAtom,
} from '@/islands/fleet-cmp/atoms.ts'
import { CmpDataRegion } from '@/islands/fleet-cmp/CmpDataRegion.tsx'
import { CmpSkeleton } from '@/islands/fleet-cmp/CmpSkeleton.tsx'
import { DEFAULT_CMP_METRIC } from '@/islands/fleet-cmp/metrics.ts'
import { MetricTabs } from '@/islands/fleet-cmp/MetricTabs.tsx'

import type { CmpLine } from '@/lib/domain/monitoring/cmp-line.ts'

/**
 * Root of the dynamic "Comparaison fleet" island. It builds a private Jotai
 * store ONCE per mount and seeds it (the cpu lines the server already loaded +
 * the slug + range) BEFORE any child reads an atom - so the default metric
 * paints from server data with no fetch and no loading flash. Switching the
 * metric tab is then client-side: only the chart + legend (inside the Suspense
 * boundary) suspend on a cold metric, while the tabs in the header stay
 * mounted and interactive. No page reload, no scroll jump. Mounted in
 * VpsMetrics.astro with `client:load`. Card/header classes copied verbatim from
 * the former server panel.
 */

interface FleetComparisonProps {
	readonly slug: string
	readonly range: string
	readonly initialLines: ReadonlyArray<CmpLine>
}

export function FleetComparison({
	slug,
	range,
	initialLines,
}: FleetComparisonProps): React.ReactElement {
	// `useState` initializer runs once: create + seed the store before render
	// reads it, without mutating anything React owns on re-render.
	const [store] = useState(() => {
		const seeded = createStore()
		seeded.set(seedAtom, {
			metric: DEFAULT_CMP_METRIC,
			lines: initialLines,
		})
		seeded.set(metricAtom, DEFAULT_CMP_METRIC)
		seeded.set(slugAtom, slug)
		seeded.set(rangeAtom, range)
		return seeded
	})

	return (
		<Provider store={store}>
			<div className="border-base-200 shadow-subtle overflow-hidden rounded-xl border bg-white">
				<header className="border-base-200 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5">
					<span className="text-base-900 text-sm font-semibold">
						Comparaison fleet
					</span>
					<MetricTabs />
				</header>
				<Suspense fallback={<CmpSkeleton />}>
					<CmpDataRegion />
				</Suspense>
			</div>
		</Provider>
	)
}
