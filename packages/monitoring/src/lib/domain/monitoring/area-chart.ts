import {
	buildLinePath,
	coord,
	FALLBACK_MAX,
	finiteSamples,
	PAD_BOTTOM,
	PAD_LEFT,
	PAD_RIGHT,
	PAD_TOP,
	safeAxisMax,
	spanned,
} from '@/lib/domain/monitoring/chart-projection.ts'

import type {
	AxisTick,
	Point,
} from '@/lib/domain/monitoring/chart-projection.ts'

const MAX_HEADROOM = 1.15
const AREA_TICK_COUNT = 5

export interface ThresholdInput {
	readonly value: number
	readonly label: string
	readonly color: string
}

export interface ThresholdLine {
	readonly label: string
	readonly color: string
	readonly y: number
}

export interface AreaGeometry {
	readonly points: ReadonlyArray<Point>
	readonly linePath: string
	readonly areaPath: string
	readonly ticks: ReadonlyArray<AxisTick>
	readonly thresholds: ReadonlyArray<ThresholdLine>
}

export interface AreaChartInput {
	readonly values: ReadonlyArray<number>
	readonly width: number
	readonly height: number
	readonly min?: number
	readonly max?: number
	readonly thresholds?: ReadonlyArray<ThresholdInput>
}

export function areaChartGeometry(input: AreaChartInput): AreaGeometry {
	const innerWidth = input.width - PAD_LEFT - PAD_RIGHT
	const innerHeight = input.height - PAD_TOP - PAD_BOTTOM
	const baseline = PAD_TOP + innerHeight
	const domainMin = input.min ?? 0
	const samples = finiteSamples(input.values)
	const headroomMax = Math.max(...samples, 0) * MAX_HEADROOM
	const autoMax = headroomMax > 0 ? headroomMax : FALLBACK_MAX
	const domainMax =
		typeof input.max === 'undefined' ? autoMax : safeAxisMax(input.max)
	const span = spanned(domainMin, domainMax)
	const count = samples.length

	const projectY = (sample: number): number =>
		PAD_TOP + innerHeight - ((sample - domainMin) / span) * innerHeight
	const projectX = (index: number): number =>
		count <= 1 ? PAD_LEFT : PAD_LEFT + (index / (count - 1)) * innerWidth

	const points: Point[] = samples.map((sample, index) => ({
		x: projectX(index),
		y: projectY(sample),
	}))
	const linePath = buildLinePath(points)
	const [firstPoint] = points
	const lastPoint = points.at(-1)
	const areaPath =
		!firstPoint || !lastPoint
			? ''
			: `${linePath} L${coord(lastPoint.x)} ${coord(baseline)} L${coord(firstPoint.x)} ${coord(baseline)} Z`

	const ticks: AxisTick[] = Array.from(
		{ length: AREA_TICK_COUNT },
		(_, i) => {
			const tickValue = domainMin + (i / (AREA_TICK_COUNT - 1)) * span
			return { value: tickValue, y: projectY(tickValue) }
		},
	)

	const thresholds: ThresholdLine[] = (input.thresholds ?? []).map(
		threshold => ({
			label: threshold.label,
			color: threshold.color,
			y: projectY(threshold.value),
		}),
	)

	return { points, linePath, areaPath, ticks, thresholds }
}
