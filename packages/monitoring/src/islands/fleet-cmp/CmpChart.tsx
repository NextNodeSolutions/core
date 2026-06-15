import { useAtomValue } from 'jotai'

import { chartSeriesAtom, metricAtom } from '@/islands/fleet-cmp/atoms.ts'
import { cmpIsPercent, cmpUnit } from '@/islands/fleet-cmp/metrics.ts'
import { MultiLine } from '@/islands/fleet-cmp/MultiLine.tsx'

/**
 * The comparison line chart for the active metric. Reads the derived chart
 * series (color-mapped peer lines) and renders the React MultiLine with the
 * metric's unit and axis: percent metrics pin to 100, the others auto-scale
 * (max left undefined). Pure render off the loaded data.
 */

const PERCENT_MAX = 100

export function CmpChart(): React.ReactElement {
	const series = useAtomValue(chartSeriesAtom)
	const metric = useAtomValue(metricAtom)

	return (
		<MultiLine
			unit={cmpUnit(metric)}
			max={cmpIsPercent(metric) ? PERCENT_MAX : undefined}
			series={series}
		/>
	)
}
