import { describe, expect, it } from 'vitest'

import { parseInstantQuery, parseInstantScalar } from './promql-response.ts'

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
