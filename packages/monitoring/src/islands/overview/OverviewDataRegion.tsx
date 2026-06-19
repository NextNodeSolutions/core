import { useAtomValue } from 'jotai'

import {
	currentWindowAtom,
	windowLoaderAtom,
} from '@/islands/overview/atoms.ts'
import { LogStream } from '@/islands/overview/LogStream.tsx'
import { OverviewNotices } from '@/islands/overview/OverviewNotices.tsx'
import { StatGrid } from '@/islands/overview/StatGrid.tsx'

/**
 * The range-dependent region behind the island's single Suspense boundary.
 * Reading `windowLoaderAtom` is the one suspend point: it gates the whole block
 * to the skeleton on a cold range while the range tabs above stay live. The
 * rendered values come from `currentWindowAtom` (the loader UNWRAPPED) so a
 * resolved range change re-renders to the new window - never the stale seed.
 */

export function OverviewDataRegion(): React.ReactElement | null {
	// Gate: suspends until the active range's window is loaded.
	useAtomValue(windowLoaderAtom)
	const overview = useAtomValue(currentWindowAtom)
	// Past the suspend gate the unwrapped value is always present; the guard is
	// only for the unwrap's null seam and keeps the type honest.
	if (overview === null) return null
	return (
		<>
			<OverviewNotices notices={overview.notices} />
			<StatGrid stats={overview.stats} />
			<LogStream stream={overview.stream} />
		</>
	)
}
