import { describe, expect, it } from 'vitest'

import { buildHostMetricExprs } from './host-metrics.ts'

describe('buildHostMetricExprs', () => {
	it('scopes every gauge to the vps_name label', () => {
		const exprs = buildHostMetricExprs('nn-prod')
		expect(exprs.cpuPercent).toContain('vps_name="nn-prod"')
		expect(exprs.memoryPercent).toContain('node_memory_MemAvailable_bytes')
		expect(exprs.diskPercent).toContain('node_filesystem_avail_bytes')
		expect(exprs.uptimeSeconds).toBe(
			'time() - node_boot_time_seconds{vps_name="nn-prod"}',
		)
	})

	it('escapes quotes and backslashes in the vps_name label matcher', () => {
		expect(buildHostMetricExprs('a"b').uptimeSeconds).toBe(
			String.raw`time() - node_boot_time_seconds{vps_name="a\"b"}`,
		)
		expect(buildHostMetricExprs('a\\b').uptimeSeconds).toBe(
			String.raw`time() - node_boot_time_seconds{vps_name="a\\b"}`,
		)
	})
})
