import { CHART_COLORS } from '@/components/charts/chart-color.ts'
import { GridTick } from '@/islands/fleet-cmp/GridTick.tsx'
import { multiLineGeometry } from '@/lib/domain/monitoring/multi-line.ts'

import type { ChartColor } from '@/components/charts/chart-color.ts'

/**
 * React port of MultiLine.astro: a multi-series line chart over a fixed
 * viewBox. The projection math is the shared pure `multiLineGeometry` domain fn
 * (same as the server version) - this component only maps its output to grid
 * ticks (GridTick) and <path> strokes, so the client and server charts stay
 * pixel identical. No state, no IO: a pure presentational SVG.
 */

const VIEW_WIDTH = 600
const DEFAULT_HEIGHT = 220
const DEFAULT_MAX = 100

interface CmpSeries {
	readonly name: string
	readonly color: ChartColor
	readonly values: ReadonlyArray<number>
}

interface MultiLineProps {
	readonly series: ReadonlyArray<CmpSeries>
	readonly height?: number
	readonly max?: number
	readonly unit?: string
}

export function MultiLine({
	series,
	height = DEFAULT_HEIGHT,
	max = DEFAULT_MAX,
	unit = '%',
}: MultiLineProps): React.ReactElement {
	const geometry = multiLineGeometry(
		series.map(line => line.values),
		{ width: VIEW_WIDTH, height, max },
	)

	return (
		<svg
			viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
			width="100%"
			className="block"
			role="img"
			aria-label="Comparaison de séries"
		>
			{geometry.ticks.map(tick => (
				<GridTick
					key={tick.y}
					tick={tick}
					viewWidth={VIEW_WIDTH}
					unit={unit}
				/>
			))}
			{series.map((line, index) => (
				<path
					key={line.name}
					d={geometry.lines[index] ?? ''}
					fill="none"
					strokeWidth="2"
					vectorEffect="non-scaling-stroke"
					className={CHART_COLORS[line.color].stroke}
				/>
			))}
		</svg>
	)
}
