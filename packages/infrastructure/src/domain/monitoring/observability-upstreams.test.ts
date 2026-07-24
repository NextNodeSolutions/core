import { describe, expect, it } from 'vitest'

import { buildObservabilityUpstreams } from './observability-upstreams.ts'

import type { ObservabilityServiceConfig } from '#/config/service-config.ts'

const CONFIG: ObservabilityServiceConfig = {
	logsRetention: '30d',
	metricsRetentionMonths: 12,
	logsVhost: 'logs.monitoring.nextnode.fr',
	metricsVhost: 'metrics.monitoring.nextnode.fr',
}

describe('buildObservabilityUpstreams', () => {
	it('routes the logs vhost to VictoriaLogs and the metrics vhost to VictoriaMetrics', () => {
		expect(buildObservabilityUpstreams(CONFIG, 'production')).toEqual([
			{
				hostname: 'logs.monitoring.nextnode.fr',
				dial: 'localhost:9428',
			},
			{
				hostname: 'metrics.monitoring.nextnode.fr',
				dial: 'localhost:8428',
			},
		])
	})

	it('resolves the per-environment hostnames like any routed service url', () => {
		const upstreams = buildObservabilityUpstreams(CONFIG, 'development')
		expect(upstreams.map(upstream => upstream.hostname)).toEqual([
			'dev.logs.monitoring.nextnode.fr',
			'dev.metrics.monitoring.nextnode.fr',
		])
	})
})
