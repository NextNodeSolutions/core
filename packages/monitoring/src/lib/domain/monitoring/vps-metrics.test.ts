import { describe, expect, it } from 'vitest'

import {
	buildVpsGaugeExprs,
	buildVpsSeriesExpr,
	rangeToHours,
	summarizeSeries,
	VPS_SERIES_METRICS,
} from './vps-metrics.ts'

describe('buildVpsSeriesExpr', () => {
	it('scopes every metric to the vps_name label', () => {
		for (const metric of VPS_SERIES_METRICS) {
			expect(buildVpsSeriesExpr('nn-prod', metric)).toContain(
				'vps_name="nn-prod"',
			)
		}
	})

	it('selects the right node_exporter series per metric', () => {
		expect(buildVpsSeriesExpr('nn-prod', 'cpu')).toContain(
			'node_cpu_seconds',
		)
		expect(buildVpsSeriesExpr('nn-prod', 'load')).toContain('node_load1')
		expect(buildVpsSeriesExpr('nn-prod', 'netOut')).toContain(
			'node_network_transmit_bytes',
		)
		expect(buildVpsSeriesExpr('nn-prod', 'netIn')).toContain(
			'node_network_receive_bytes',
		)
		expect(buildVpsSeriesExpr('nn-prod', 'diskIo')).toContain(
			'node_disk_written_bytes',
		)
	})
})

describe('buildVpsGaugeExprs', () => {
	it('exposes load average, swap and network gauges scoped to the vps', () => {
		const exprs = buildVpsGaugeExprs('nn-prod')
		expect(exprs.load1).toContain('node_load1{vps_name="nn-prod"}')
		expect(exprs.load5).toContain('node_load5')
		expect(exprs.load15).toContain('node_load15')
		expect(exprs.swapPercent).toContain('node_memory_SwapFree')
		expect(exprs.netInMbps).toContain('node_network_receive_bytes')
		expect(exprs.netOutMbps).toContain('node_network_transmit_bytes')
	})
})

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

describe('rangeToHours', () => {
	it('maps range keys to query windows and defaults unknown keys to 1h', () => {
		expect(rangeToHours('6h')).toBe(6)
		expect(rangeToHours('7d')).toBe(168)
		expect(rangeToHours('30d')).toBe(720)
		expect(rangeToHours('bogus')).toBe(1)
	})
})
