import { isRecord } from '@/lib/domain/is-record.ts'

/**
 * One sample of a VictoriaMetrics/Prometheus instant query result: the
 * metric's label set plus its scalar value at the query instant.
 */
export interface InstantSample {
	readonly labels: Readonly<Record<string, string>>
	readonly value: number
}

const parseLabels = (metric: unknown): Readonly<Record<string, string>> => {
	if (!isRecord(metric)) return {}
	const labels: Record<string, string> = {}
	for (const [key, labelValue] of Object.entries(metric)) {
		if (typeof labelValue === 'string') labels[key] = labelValue
	}
	return labels
}

/**
 * The instant-query value tuple is `[unixSeconds, "stringifiedNumber"]`.
 * VictoriaMetrics emits NaN/Inf as the strings "NaN"/"+Inf"/"-Inf";
 * those are dropped (a non-finite sample is not a usable gauge reading).
 */
const VALUE_TUPLE_LENGTH = 2

const parseValueTuple = (tuple: unknown): number | null => {
	if (!Array.isArray(tuple) || tuple.length < VALUE_TUPLE_LENGTH) return null
	const [, raw] = tuple
	if (typeof raw !== 'string') return null
	const num = Number(raw)
	return Number.isFinite(num) ? num : null
}

const SECONDS_TO_MS = 1000

/** One time-series sample: a millisecond timestamp and its numeric value. */
export interface RangePoint {
	readonly t: number
	readonly v: number
}

const parseRangeTuple = (tuple: unknown): RangePoint | null => {
	if (!Array.isArray(tuple) || tuple.length < VALUE_TUPLE_LENGTH) return null
	const [seconds, raw] = tuple
	if (typeof seconds !== 'number' || typeof raw !== 'string') return null
	const num = Number(raw)
	return Number.isFinite(num) ? { t: seconds * SECONDS_TO_MS, v: num } : null
}

/**
 * Parse a VictoriaMetrics `/api/v1/query` (instant) response body into a
 * flat list of samples. Pure - the adapter hands the decoded JSON in.
 * A non-`success` status or a non-vector result yields an empty list
 * rather than throwing: a query that matches nothing is an answer, and
 * the caller renders an empty/"-" state.
 */
export const parseInstantQuery = (
	payload: unknown,
): ReadonlyArray<InstantSample> => {
	if (!isRecord(payload) || payload.status !== 'success') return []
	if (!isRecord(payload.data) || !Array.isArray(payload.data.result)) {
		return []
	}
	const samples: Array<InstantSample> = []
	for (const entry of payload.data.result) {
		if (!isRecord(entry)) continue
		const sampleValue = parseValueTuple(entry.value)
		if (sampleValue === null) continue
		samples.push({
			labels: parseLabels(entry.metric),
			value: sampleValue,
		})
	}
	return samples
}

/**
 * Reduce an instant-query response to a single scalar - the value of its
 * first sample, or `null` when the query matched nothing. Use for
 * aggregate expressions (a `sum`/`avg` with no `by` clause returns one
 * series).
 */
export const parseInstantScalar = (payload: unknown): number | null => {
	const [first] = parseInstantQuery(payload)
	return first?.value ?? null
}

/**
 * Parse a VictoriaMetrics `/api/v1/query_range` (matrix) response into the
 * first series' points, newest order preserved. Aggregate range expressions
 * (no `by` clause) return a single series, so the first is the gauge over
 * time. Non-finite samples are dropped; a non-success/empty body yields `[]`.
 */
export const parseRangeQuery = (
	payload: unknown,
): ReadonlyArray<RangePoint> => {
	if (!isRecord(payload) || payload.status !== 'success') return []
	if (!isRecord(payload.data) || !Array.isArray(payload.data.result)) {
		return []
	}
	const [firstSeries] = payload.data.result
	if (!isRecord(firstSeries) || !Array.isArray(firstSeries.values)) return []
	const points: Array<RangePoint> = []
	for (const tuple of firstSeries.values) {
		const point = parseRangeTuple(tuple)
		if (point !== null) points.push(point)
	}
	return points
}
