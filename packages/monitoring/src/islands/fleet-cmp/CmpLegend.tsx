import { useAtomValue } from 'jotai'

import { chartSeriesAtom, legendDotClass } from '@/islands/fleet-cmp/atoms.ts'

/**
 * Legend chips for the comparison chart: one colored dot + peer name per
 * series, with the current host bolded and tagged `(actuel)`. Reads the derived
 * chart series, so the colors and the highlight match the chart exactly. Copies
 * the former server legend's classes 1:1.
 */

export function CmpLegend(): React.ReactElement {
	const series = useAtomValue(chartSeriesAtom)

	return (
		<div className="flex flex-wrap gap-3.5 px-4 pt-1 pb-4">
			{series.map(line => (
				<span
					key={line.name}
					className={`flex items-center gap-1.5 text-xs ${
						line.isCurrent
							? 'text-base-900 font-bold'
							: 'text-base-700 font-medium'
					}`}
				>
					<span
						className={`size-2.5 rounded-full ${legendDotClass(line.color)}`}
					/>
					{line.name}
					{line.isCurrent && (
						<span className="text-base-500">(actuel)</span>
					)}
				</span>
			))}
		</div>
	)
}
