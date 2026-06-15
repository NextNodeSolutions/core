import {
	buildLinePath,
	coord,
	finiteSamples,
	spanned,
} from '@/lib/domain/monitoring/chart-projection.ts'

import type { Point } from '@/lib/domain/monitoring/chart-projection.ts'

const SPARK_PAD = 3

export interface SparklineGeometry {
	readonly linePath: string
	readonly areaPath: string
	readonly lastX: number
	readonly lastY: number
}

export function sparklineGeometry(
	values: ReadonlyArray<number>,
	width: number,
	height: number,
): SparklineGeometry {
	const samples = finiteSamples(values)
	const domainMin = Math.min(...samples)
	const domainMax = Math.max(...samples)
	const span = spanned(domainMin, domainMax)
	const usableHeight = height - SPARK_PAD - SPARK_PAD
	const count = samples.length

	const points: Point[] = samples.map((sample, index) => ({
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
