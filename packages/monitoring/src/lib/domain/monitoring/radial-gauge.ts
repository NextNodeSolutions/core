const HALF_DIVISOR = 2
const PCT_MAX = 100
const PCT_MIN = 0

export interface RadialGaugeGeometry {
	readonly center: number
	readonly radius: number
	readonly circumference: number
	readonly dashOffset: number
}

function clampPercent(percent: number): number {
	return Math.min(PCT_MAX, Math.max(PCT_MIN, percent))
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
