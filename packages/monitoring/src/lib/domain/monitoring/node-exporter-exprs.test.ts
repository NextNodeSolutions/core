import { describe, expect, it } from 'vitest'

import {
	NODE_EXPORTER_EXPR,
	NODE_EXPORTER_METRICS,
} from './node-exporter-exprs.ts'

describe('NODE_EXPORTER_EXPR', () => {
	it('scopes every metric to the vps_name label', () => {
		for (const metric of NODE_EXPORTER_METRICS) {
			expect(NODE_EXPORTER_EXPR[metric]('nn-prod')).toContain(
				'vps_name="nn-prod"',
			)
		}
	})

	it('builds the canonical cpu/mem/disk expressions', () => {
		expect(NODE_EXPORTER_EXPR.cpu('nn-prod')).toBe(
			'100 - (avg(rate(node_cpu_seconds_total{vps_name="nn-prod",mode="idle"}[5m])) * 100)',
		)
		expect(NODE_EXPORTER_EXPR.mem('nn-prod')).toBe(
			'100 * (1 - node_memory_MemAvailable_bytes{vps_name="nn-prod"} / node_memory_MemTotal_bytes{vps_name="nn-prod"})',
		)
		expect(NODE_EXPORTER_EXPR.disk('nn-prod')).toBe(
			'100 * (1 - node_filesystem_avail_bytes{vps_name="nn-prod",mountpoint="/",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{vps_name="nn-prod",mountpoint="/",fstype!~"tmpfs|overlay"})',
		)
	})

	it('escapes quotes and backslashes in the vps_name label matcher', () => {
		expect(NODE_EXPORTER_EXPR.uptime('a"b')).toBe(
			String.raw`time() - node_boot_time_seconds{vps_name="a\"b"}`,
		)
		expect(NODE_EXPORTER_EXPR.cpu('a\\b')).toContain(
			String.raw`vps_name="a\\b"`,
		)
	})
})
