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
