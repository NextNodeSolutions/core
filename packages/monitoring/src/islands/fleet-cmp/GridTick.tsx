import type { AxisTick } from '@/lib/domain/monitoring/chart-projection.ts'

/**
 * One horizontal grid line + its right-aligned axis label, for the MultiLine
 * chart. The tick value and y come from the shared chart geometry; this
 * component only emits the <line>/<text> pair. Pure presentational SVG.
 */

const LABEL_RIGHT = 34
const TICK_LINE_LEFT_GAP = 6
const TICK_LINE_RIGHT_GAP = 12
const TICK_LABEL_BASELINE_OFFSET = 3

interface GridTickProps {
	readonly tick: AxisTick
	readonly viewWidth: number
	readonly unit: string
}

export function GridTick({
	tick,
	viewWidth,
	unit,
}: GridTickProps): React.ReactElement {
	return (
		<g>
			<line
				x1={LABEL_RIGHT + TICK_LINE_LEFT_GAP}
				x2={viewWidth - TICK_LINE_RIGHT_GAP}
				y1={tick.y}
				y2={tick.y}
				className="stroke-base-100"
				strokeWidth="1"
			/>
			<text
				x={LABEL_RIGHT}
				y={tick.y + TICK_LABEL_BASELINE_OFFSET}
				textAnchor="end"
				className="fill-base-400 font-mono text-[10px]"
			>
				{`${Math.round(tick.value)}${unit}`}
			</text>
		</g>
	)
}
