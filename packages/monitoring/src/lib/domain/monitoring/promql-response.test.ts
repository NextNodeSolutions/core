import { describe, expect, it } from 'vitest'

import {
	parseInstantQuery,
	parseInstantScalar,
	parseRangeQuery,
} from './promql-response.ts'

const vmResponse = (entries: unknown): unknown => ({
	status: 'success',
	data: { resultType: 'vector', result: entries },
})

describe('parseInstantQuery', () => {
	it('parses samples with labels and numeric values', () => {
		const samples = parseInstantQuery(
			vmResponse([
				{
					metric: { vps_name: 'stylot', __name__: 'x' },
					value: [1781233200, '42.5'],
				},
			]),
		)
		expect(samples).toEqual([
			{ labels: { vps_name: 'stylot', __name__: 'x' }, value: 42.5 },
		])
	})

	it('drops non-finite values (NaN/Inf strings)', () => {
		const samples = parseInstantQuery(
			vmResponse([{ metric: {}, value: [1, 'NaN'] }]),
		)
		expect(samples).toEqual([])
	})

	it('returns empty on a non-success status', () => {
		expect(parseInstantQuery({ status: 'error' })).toEqual([])
	})

	it('returns empty on a malformed payload', () => {
		expect(parseInstantQuery(null)).toEqual([])
		expect(parseInstantQuery({ status: 'success', data: {} })).toEqual([])
	})
})

describe('parseInstantScalar', () => {
	it('returns the first sample value', () => {
		expect(
			parseInstantScalar(vmResponse([{ metric: {}, value: [1, '7'] }])),
		).toBe(7)
	})

	it('returns null when nothing matched', () => {
		expect(parseInstantScalar(vmResponse([]))).toBeNull()
	})
})

const vmRangeResponse = (values: unknown): unknown => ({
	status: 'success',
	data: {
		resultType: 'matrix',
		result: [{ metric: { vps_name: 'nn-prod' }, values }],
	},
})

describe('parseRangeQuery', () => {
	it('maps matrix value tuples to millisecond-stamped points', () => {
		const points = parseRangeQuery(
			vmRangeResponse([
				[1_700_000_000, '12.5'],
				[1_700_000_060, '37'],
			]),
		)
		expect(points).toEqual([
			{ t: 1_700_000_000_000, v: 12.5 },
			{ t: 1_700_000_060_000, v: 37 },
		])
	})

	it('drops non-finite samples (NaN/Inf) but keeps the rest', () => {
		const points = parseRangeQuery(
			vmRangeResponse([
				[1_700_000_000, 'NaN'],
				[1_700_000_060, '5'],
			]),
		)
		expect(points).toEqual([{ t: 1_700_000_060_000, v: 5 }])
	})

	it('returns an empty list for a failed or empty response', () => {
		expect(parseRangeQuery({ status: 'error' })).toEqual([])
		expect(
			parseRangeQuery({ status: 'success', data: { result: [] } }),
		).toEqual([])
	})
})
