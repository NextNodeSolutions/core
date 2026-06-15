import {
	buildLinePath,
	finiteSamples,
	PAD_BOTTOM,
	PAD_LEFT,
	PAD_RIGHT,
	PAD_TOP,
	safeAxisMax,
} from '@/lib/domain/monitoring/chart-projection.ts'

import type { AxisTick } from '@/lib/domain/monitoring/chart-projection.ts'

const MULTI_TICK_COUNT = 3

export interface MultiLineInput {
	readonly width: number
	readonly height: number
	readonly max: number
}

export interface MultiLineGeometry {
	readonly lines: ReadonlyArray<string>
	readonly ticks: ReadonlyArray<AxisTick>
}

export function multiLineGeometry(
	seriesValues: ReadonlyArray<ReadonlyArray<number>>,
	input: MultiLineInput,
): MultiLineGeometry {
	const innerWidth = input.width - PAD_LEFT - PAD_RIGHT
	const innerHeight = input.height - PAD_TOP - PAD_BOTTOM
	const axisMax = safeAxisMax(input.max)
	const count = seriesValues[0]?.length ?? 1

	const projectX = (index: number): number =>
		count <= 1 ? PAD_LEFT : PAD_LEFT + (index / (count - 1)) * innerWidth
	const projectY = (sample: number): number =>
		PAD_TOP + innerHeight - (sample / axisMax) * innerHeight

	const lines = seriesValues.map(values =>
		buildLinePath(
			finiteSamples(values).map((sample, index) => ({
				x: projectX(index),
				y: projectY(sample),
			})),
		),
	)
	const ticks: AxisTick[] = Array.from(
		{ length: MULTI_TICK_COUNT },
		(_, i) => {
			const tickValue = (i / (MULTI_TICK_COUNT - 1)) * axisMax
			return { value: tickValue, y: projectY(tickValue) }
		},
	)

	return { lines, ticks }
}
