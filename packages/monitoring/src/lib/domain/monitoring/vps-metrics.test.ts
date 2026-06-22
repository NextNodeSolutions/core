import { describe, expect, it } from 'vitest'

import {
	buildVpsGaugeExprs,
	buildVpsSeriesExpr,
	rangeToHours,
	VPS_SERIES_METRICS,
	windowToLogsQL,
} from './vps-metrics.ts'

describe('buildVpsSeriesExpr', () => {
	it('scopes every metric to the vps_name label', () => {
		for (const metric of VPS_SERIES_METRICS) {
			expect(buildVpsSeriesExpr('nn-prod', metric)).toContain(
				'vps_name="nn-prod"',
			)
		}
	})

	it('builds the full PromQL expression per metric', () => {
		expect(buildVpsSeriesExpr('nn-prod', 'cpu')).toBe(
			'100 - (avg(rate(node_cpu_seconds_total{vps_name="nn-prod",mode="idle"}[5m])) * 100)',
		)
		expect(buildVpsSeriesExpr('nn-prod', 'mem')).toBe(
			'100 * (1 - node_memory_MemAvailable_bytes{vps_name="nn-prod"} / node_memory_MemTotal_bytes{vps_name="nn-prod"})',
		)
		expect(buildVpsSeriesExpr('nn-prod', 'disk')).toBe(
			'100 * (1 - node_filesystem_avail_bytes{vps_name="nn-prod",mountpoint="/",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{vps_name="nn-prod",mountpoint="/",fstype!~"tmpfs|overlay"})',
		)
	})

	it('escapes quotes and backslashes in the vps_name label matcher', () => {
		expect(buildVpsSeriesExpr('a"b', 'load')).toBe(
			String.raw`node_load1{vps_name="a\"b"}`,
		)
		expect(buildVpsSeriesExpr('a\\b', 'load')).toBe(
			String.raw`node_load1{vps_name="a\\b"}`,
		)
	})

	it('selects the right node_exporter series per metric', () => {
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

describe('rangeToHours', () => {
	it('maps range keys to query windows and defaults unknown keys to 1h', () => {
		expect(rangeToHours('6h')).toBe(6)
		expect(rangeToHours('7d')).toBe(168)
		expect(rangeToHours('30d')).toBe(720)
		expect(rangeToHours('bogus')).toBe(1)
	})

	it('makes `live` a short 5-minute window, distinct from the 1h tab', () => {
		expect(rangeToHours('live')).toBeCloseTo(5 / 60)
		expect(rangeToHours('1h')).toBe(1)
		// The whole fix: live must NOT equal 1h.
		expect(rangeToHours('live')).not.toBe(rangeToHours('1h'))
	})
})

describe('windowToLogsQL', () => {
	it('emits minutes for a sub-hour window and hours for whole hours', () => {
		expect(windowToLogsQL(5 / 60)).toBe('5m') // live
		expect(windowToLogsQL(1)).toBe('1h')
		expect(windowToLogsQL(6)).toBe('6h')
		expect(windowToLogsQL(24)).toBe('24h')
	})
})
