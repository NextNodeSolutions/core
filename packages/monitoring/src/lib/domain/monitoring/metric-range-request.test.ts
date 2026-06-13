import { describe, expect, it } from 'vitest'

import { parseMetricRangeRequest } from './metric-range-request.ts'

const NOW = 1_781_233_200

describe('parseMetricRangeRequest', () => {
	it('builds a bounded range query for a known metric', () => {
		const outcome = parseMetricRangeRequest(
			{ vpsName: 'stylot', metric: 'cpuPercent', hours: '2' },
			NOW,
		)
		expect(outcome.ok).toBe(true)
		if (outcome.ok) {
			expect(outcome.request.expr).toContain('vps_name="stylot"')
			expect(outcome.request.endSeconds).toBe(NOW)
			expect(outcome.request.startSeconds).toBe(NOW - 2 * 3600)
			expect(outcome.request.stepSeconds).toBe(60)
		}
	})

	it('defaults to a one-hour window', () => {
		const outcome = parseMetricRangeRequest(
			{ vpsName: 'stylot', metric: 'diskPercent', hours: null },
			NOW,
		)
		expect(outcome.ok).toBe(true)
		if (outcome.ok) {
			expect(outcome.request.startSeconds).toBe(NOW - 3600)
		}
	})

	it('rejects an unknown metric key (no arbitrary PromQL passthrough)', () => {
		const outcome = parseMetricRangeRequest(
			{ vpsName: 'stylot', metric: 'node_cpu_seconds_total', hours: '1' },
			NOW,
		)
		expect(outcome).toEqual({
			ok: false,
			error: 'metric must be one of: cpuPercent, memoryPercent, diskPercent, uptimeSeconds',
		})
	})

	it('rejects a non-positive or oversized window', () => {
		expect(
			parseMetricRangeRequest(
				{ vpsName: 'x', metric: 'cpuPercent', hours: '0' },
				NOW,
			).ok,
		).toBe(false)
		expect(
			parseMetricRangeRequest(
				{ vpsName: 'x', metric: 'cpuPercent', hours: '9999' },
				NOW,
			).ok,
		).toBe(false)
		expect(
			parseMetricRangeRequest(
				{ vpsName: 'x', metric: 'cpuPercent', hours: 'abc' },
				NOW,
			).ok,
		).toBe(false)
	})
})
