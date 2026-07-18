import { useAtom } from 'jotai'

import { ACTIVITY_SOURCE_OPTIONS } from '@/components/deployments/activity-display.ts'
import { sourceAtom } from '@/islands/deployments/atoms.ts'
import { FilterTabs } from '@/islands/deployments/FilterTabs.tsx'

/**
 * The Tous / Pages / VPS segmented control over the recent-activity list.
 * Selecting a tab sets `sourceAtom`; the merged feed recomputes client-side
 * with no reload. Options come from the shared activity-display registry,
 * whose keys type-check against the domain filter union.
 */

export function SourceFilterTabs(): React.ReactElement {
	const [source, setSource] = useAtom(sourceAtom)

	return (
		<FilterTabs
			options={ACTIVITY_SOURCE_OPTIONS}
			selected={source}
			onSelect={setSource}
			ariaLabel="Filtrer par source"
		/>
	)
}
