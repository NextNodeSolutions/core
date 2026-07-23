import type { RangePoint } from '@/lib/domain/monitoring/promql-response.ts'

/**
 * Reduce a fetched metric series to the headline values the detail panels
 * render. Pure: the adapter fetches the points, this only summarises them.
 * An empty series yields nulls so the panel shows "-" rather than a fabricated
 * zero.
 */

export interface SeriesSummary {
	readonly average: number | null
	readonly peak: number | null
}

export const summarizeSeries = (
	points: ReadonlyArray<RangePoint>,
): SeriesSummary => {
	if (!points.length) return { average: null, peak: null }
	const values = points.map(point => point.v)
	const total = values.reduce((sum, sample) => sum + sample, 0)
	return { average: total / values.length, peak: Math.max(...values) }
}
