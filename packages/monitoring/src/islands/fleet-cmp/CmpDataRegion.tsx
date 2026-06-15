import { useAtomValue } from 'jotai'

import { cmpLoaderAtom } from '@/islands/fleet-cmp/atoms.ts'
import { CmpChart } from '@/islands/fleet-cmp/CmpChart.tsx'
import { CmpLegend } from '@/islands/fleet-cmp/CmpLegend.tsx'

/**
 * The data-dependent region behind the panel's Suspense boundary. Reading
 * `cmpLoaderAtom` is the single suspend point: it gates the chart + legend to
 * the fallback on a cold metric while the tabs in the header stay live. Once
 * loaded, the chart and legend read sync derived atoms, so re-rendering is
 * instant and never re-suspends.
 */

export function CmpDataRegion(): React.ReactElement {
	// Gate: suspends until the active metric's lines are loaded.
	useAtomValue(cmpLoaderAtom)

	return (
		<>
			<div className="px-2.5 pt-3 pb-1.5">
				<CmpChart />
			</div>
			<CmpLegend />
		</>
	)
}
