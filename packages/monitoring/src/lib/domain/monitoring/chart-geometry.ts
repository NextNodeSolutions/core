/**
 * Pure SVG chart geometry for the monitoring dashboard.
 *
 * Charts render server-side, so all projection math lives here (tested) and
 * the `.astro` components only emit the precomputed paths into a fixed
 * `viewBox` coordinate space that scales to the container. No IO, no clock.
 */

const PAD_LEFT = 40
const PAD_RIGHT = 12
const PAD_TOP = 12
const PAD_BOTTOM = 22
const MAX_HEADROOM = 1.15
const AREA_TICK_COUNT = 5
const MULTI_TICK_COUNT = 3
const SPARK_PAD = 3
const HALF_DIVISOR = 2
const PCT_MAX = 100
const PCT_MIN = 0
const FALLBACK_MAX = 1

export interface Point {
	readonly x: number
	readonly y: number
}

export interface AxisTick {
	readonly value: number
	readonly y: number
}

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

export interface SparklineGeometry {
	readonly linePath: string
	readonly areaPath: string
	readonly lastX: number
	readonly lastY: number
}

export interface RadialGaugeGeometry {
	readonly center: number
	readonly radius: number
	readonly circumference: number
	readonly dashOffset: number
}

export interface MultiLineInput {
	readonly width: number
	readonly height: number
	readonly max: number
}

export interface MultiLineGeometry {
	readonly lines: ReadonlyArray<string>
	readonly ticks: ReadonlyArray<AxisTick>
}

const coord = (coordinate: number): string => coordinate.toFixed(1)

export function buildLinePath(points: ReadonlyArray<Point>): string {
	return points
		.map(
			(point, index) =>
				`${index === 0 ? 'M' : 'L'}${coord(point.x)} ${coord(point.y)}`,
		)
		.join(' ')
}

function clampPercent(percent: number): number {
	return Math.min(PCT_MAX, Math.max(PCT_MIN, percent))
}

function spanned(min: number, max: number): number {
	return max > min ? max - min : FALLBACK_MAX
}

export function areaChartGeometry(input: AreaChartInput): AreaGeometry {
	const innerWidth = input.width - PAD_LEFT - PAD_RIGHT
	const innerHeight = input.height - PAD_TOP - PAD_BOTTOM
	const baseline = PAD_TOP + innerHeight
	const domainMin = input.min ?? 0
	const headroomMax = Math.max(...input.values, 0) * MAX_HEADROOM
	const domainMax =
		input.max ?? (headroomMax > 0 ? headroomMax : FALLBACK_MAX)
	const span = spanned(domainMin, domainMax)
	const count = input.values.length

	const projectY = (sample: number): number =>
		PAD_TOP + innerHeight - ((sample - domainMin) / span) * innerHeight
	const projectX = (index: number): number =>
		count <= 1 ? PAD_LEFT : PAD_LEFT + (index / (count - 1)) * innerWidth

	const points: Point[] = input.values.map((sample, index) => ({
		x: projectX(index),
		y: projectY(sample),
	}))
	const linePath = buildLinePath(points)
	const [firstPoint] = points
	const lastPoint = points.at(-1)
	const areaPath =
		firstPoint === undefined || lastPoint === undefined
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

export function sparklineGeometry(
	values: ReadonlyArray<number>,
	width: number,
	height: number,
): SparklineGeometry {
	const domainMin = Math.min(...values)
	const domainMax = Math.max(...values)
	const span = spanned(domainMin, domainMax)
	const usableHeight = height - SPARK_PAD - SPARK_PAD
	const count = values.length

	const points: Point[] = values.map((sample, index) => ({
		x: count <= 1 ? 0 : (index / (count - 1)) * width,
		y: height - SPARK_PAD - ((sample - domainMin) / span) * usableHeight,
	}))
	const linePath = buildLinePath(points)
	const last = points.at(-1) ?? { x: 0, y: height - SPARK_PAD }
	const areaPath =
		points.length === 0
			? ''
			: `${linePath} L${coord(width)} ${coord(height)} L0.0 ${coord(height)} Z`

	return { linePath, areaPath, lastX: last.x, lastY: last.y }
}

export function radialGaugeGeometry(
	sample: number,
	size: number,
	stroke: number,
): RadialGaugeGeometry {
	const radius = (size - stroke) / HALF_DIVISOR
	const circumference = Math.PI * (radius + radius)
	const percent = clampPercent(sample)
	return {
		center: size / HALF_DIVISOR,
		radius,
		circumference,
		dashOffset: circumference * (1 - percent / PCT_MAX),
	}
}

export function multiLineGeometry(
	seriesValues: ReadonlyArray<ReadonlyArray<number>>,
	input: MultiLineInput,
): MultiLineGeometry {
	const innerWidth = input.width - PAD_LEFT - PAD_RIGHT
	const innerHeight = input.height - PAD_TOP - PAD_BOTTOM
	const count = seriesValues[0]?.length ?? 1

	const projectX = (index: number): number =>
		count <= 1 ? PAD_LEFT : PAD_LEFT + (index / (count - 1)) * innerWidth
	const projectY = (sample: number): number =>
		PAD_TOP + innerHeight - (sample / input.max) * innerHeight

	const lines = seriesValues.map(values =>
		buildLinePath(
			values.map((sample, index) => ({
				x: projectX(index),
				y: projectY(sample),
			})),
		),
	)
	const ticks: AxisTick[] = Array.from(
		{ length: MULTI_TICK_COUNT },
		(_, i) => {
			const tickValue = (i / (MULTI_TICK_COUNT - 1)) * input.max
			return { value: tickValue, y: projectY(tickValue) }
		},
	)

	return { lines, ticks }
}
