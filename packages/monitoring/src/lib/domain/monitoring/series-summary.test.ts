import { describe, expect, it } from 'vitest'

import { summarizeSeries } from './series-summary.ts'

describe('summarizeSeries', () => {
	it('returns the mean and peak of the sampled values', () => {
		expect(
			summarizeSeries([
				{ t: 1, v: 10 },
				{ t: 2, v: 20 },
				{ t: 3, v: 30 },
			]),
		).toEqual({ average: 20, peak: 30 })
	})

	it('returns nulls for an empty series', () => {
		expect(summarizeSeries([])).toEqual({ average: null, peak: null })
	})
})
