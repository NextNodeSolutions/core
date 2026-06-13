import { describe, expect, it } from 'vitest'

import { formatHostMetrics } from './host-metrics-display.ts'

describe('formatHostMetrics', () => {
	it('formats percentages and uptime with tones below thresholds', () => {
		const rows = formatHostMetrics({
			cpuPercent: 12.34,
			memoryPercent: 40,
			diskPercent: 50,
			uptimeSeconds: 90_000,
		})
		expect(rows.map(r => [r.label, r.value, r.tone])).toEqual([
			['CPU load', '12.3%', 'positive'],
			['Memory', '40.0%', 'positive'],
			['Disk', '50.0%', 'positive'],
			['Uptime', '1d', 'neutral'],
		])
	})

	it('warns when a gauge crosses its alert threshold', () => {
		const rows = formatHostMetrics({
			cpuPercent: 95,
			memoryPercent: 92,
			diskPercent: 88,
			uptimeSeconds: 3600,
		})
		expect(rows.map(r => r.tone)).toEqual([
			'warning',
			'warning',
			'warning',
			'neutral',
		])
		expect(rows[3]?.value).toBe('1h')
	})

	it('renders nulls as "-" with a neutral tone', () => {
		const rows = formatHostMetrics({
			cpuPercent: null,
			memoryPercent: null,
			diskPercent: null,
			uptimeSeconds: null,
		})
		for (const row of rows) {
			expect(row.value).toBe('-')
			expect(row.tone).toBe('neutral')
		}
	})
})
