import { Suspense } from 'react'

import { FilterBar } from '@/islands/logs/FilterBar.tsx'
import { LevelChips } from '@/islands/logs/LevelChips.tsx'
import { LogsDataRegion } from '@/islands/logs/LogsDataRegion.tsx'
import { LogsSkeleton } from '@/islands/logs/LogsSkeleton.tsx'
import { RangeTabs } from '@/islands/logs/RangeTabs.tsx'

/**
 * The screen body, mounted inside the island's seeded Jotai store. It lays out
 * the always-interactive controls above a single Suspense boundary that wraps
 * ONLY the data-dependent region (volume histogram + list + detail panel). On a
 * range change just that region suspends to a skeleton; the range tabs, search,
 * facets and chips stay mounted and usable. `initialRange` only labels the
 * skeleton on first paint.
 */

interface ExplorerScreenProps {
	readonly initialRange: string
}

export function ExplorerScreen({
	initialRange,
}: ExplorerScreenProps): React.ReactElement {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="border-base-200 flex flex-none flex-col gap-3 border-b px-6 py-3.5">
				<div className="flex flex-wrap items-center justify-between gap-2.5">
					<FilterBar />
					<RangeTabs />
				</div>
				<LevelChips />
			</div>

			<Suspense fallback={<LogsSkeleton range={initialRange} />}>
				<LogsDataRegion />
			</Suspense>
		</div>
	)
}
