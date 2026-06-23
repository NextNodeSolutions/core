import { useAtomValue } from 'jotai'

import {
	bucketsAtom,
	logsLoaderAtom,
	rangeAtom,
	windowTotalAtom,
} from '@/islands/logs/atoms.ts'
import { LogDetailPanel } from '@/islands/logs/LogDetailPanel.tsx'
import { LogHistogram } from '@/islands/logs/LogHistogram.tsx'
import { LogList } from '@/islands/logs/LogList.tsx'
import { formatTime } from '@/lib/domain/monitoring/format.ts'

/**
 * The data-dependent region behind the Suspense boundary. Reading
 * `logsLoaderAtom` is the single suspend point: it gates the whole region to
 * the skeleton on a cold range while the controls above stay live. Once loaded,
 * the histogram / list / detail panel all read sync derived atoms, so filtering
 * and selection recompute instantly without re-suspending.
 */

export function LogsDataRegion(): React.ReactElement {
	// Gate: suspends until the active range's logs are loaded.
	useAtomValue(logsLoaderAtom)
	const buckets = useAtomValue(bucketsAtom)
	// Windowed total (the whole range), not the sample size - so the number
	// moves with the time filter just like the histogram above it.
	const windowTotal = useAtomValue(windowTotalAtom)
	const range = useAtomValue(rangeAtom)
	const [firstBucket] = buckets

	return (
		<>
			<div className="border-base-200 flex-none border-b px-6 pt-3 pb-1">
				<div className="mb-1.5 flex items-center justify-between">
					<span className="text-base-500 font-mono text-[10.5px] font-semibold tracking-[0.06em] uppercase">
						Volume · {range}
					</span>
					<span className="text-base-500 font-mono text-[10.5px]">
						{windowTotal} évènements
					</span>
				</div>
				<LogHistogram />
				<div className="mt-0.5 flex items-center justify-between">
					<span className="text-base-400 font-mono text-[10px]">
						{firstBucket ? formatTime(firstBucket.t) : ''}
					</span>
					<span className="text-base-400 font-mono text-[10px]">
						maintenant
					</span>
				</div>
			</div>

			<div className="flex min-h-0 flex-1">
				<div className="min-w-0 flex-1 overflow-auto">
					<div className="border-base-100 text-base-400 sticky top-0 z-2 flex gap-2.5 border-b bg-white/90 px-3.5 py-1.5 font-mono text-[10px] tracking-[0.04em] uppercase backdrop-blur">
						<span className="flex-none">time</span>
						<span className="w-12 flex-none">level</span>
						<span className="w-28 flex-none">service</span>
						<span className="flex-1">message</span>
					</div>
					<LogList />
				</div>

				<LogDetailPanel />
			</div>
		</>
	)
}
