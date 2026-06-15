/**
 * Shared SVG projection primitives for the chart-geometry family. Charts render
 * server-side, so all projection math lives here (tested) and the `.astro`
 * components only emit the precomputed paths into a fixed `viewBox`. No IO.
 */

export const PAD_LEFT = 40
export const PAD_RIGHT = 12
export const PAD_TOP = 12
export const PAD_BOTTOM = 22
export const FALLBACK_MAX = 1

export interface Point {
	readonly x: number
	readonly y: number
}

export interface AxisTick {
	readonly value: number
	readonly y: number
}

export const coord = (coordinate: number): string => coordinate.toFixed(1)

// A series can carry NaN/Infinity (a dropped scrape, a divide-by-zero
// upstream). Projecting those straight into SVG coordinates emits
// "NaN"/"Infinity" into the path, which the renderer cannot parse - so drop
// them before any projection.
export const finiteSamples = (
	values: ReadonlyArray<number>,
): ReadonlyArray<number> => values.filter(sample => Number.isFinite(sample))

// A zero / non-finite axis maximum makes `sample / max` blow up. Fall back to
// a unit axis so the projection stays finite (flat at the baseline).
export const safeAxisMax = (max: number): number =>
	Number.isFinite(max) && max > 0 ? max : FALLBACK_MAX

export const spanned = (min: number, max: number): number =>
	max > min ? max - min : FALLBACK_MAX

export function buildLinePath(points: ReadonlyArray<Point>): string {
	return points
		.map(
			(point, index) =>
				`${index === 0 ? 'M' : 'L'}${coord(point.x)} ${coord(point.y)}`,
		)
		.join(' ')
}
