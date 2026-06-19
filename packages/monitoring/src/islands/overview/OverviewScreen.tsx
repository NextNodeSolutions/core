import { Suspense } from 'react'

import { OverviewDataRegion } from '@/islands/overview/OverviewDataRegion.tsx'
import { OverviewSkeleton } from '@/islands/overview/OverviewSkeleton.tsx'
import { RangeTabs } from '@/islands/overview/RangeTabs.tsx'

/**
 * The range-reactive top of the overview, mounted inside the island's seeded
 * Jotai store. The range tabs stay live above a single Suspense boundary that
 * wraps ONLY the windowed region (stats + log preview): a range change suspends
 * just that block to a same-shape skeleton, never the tabs. The range-
 * INDEPENDENT sections (alerts, fleet grid, recent deployments) render on the
 * server below this island and never refetch.
 */

export function OverviewScreen(): React.ReactElement {
	return (
		<div className="flex flex-col gap-5">
			<div className="flex items-center justify-between gap-3">
				<span className="text-base-700 inline-flex items-center gap-2 font-mono text-[11px] font-semibold tracking-[0.12em] uppercase">
					<span className="bg-base-900 size-2.5 rounded-[2px]" />
					Activité fleet
				</span>
				<RangeTabs />
			</div>
			<Suspense fallback={<OverviewSkeleton />}>
				<OverviewDataRegion />
			</Suspense>
		</div>
	)
}
