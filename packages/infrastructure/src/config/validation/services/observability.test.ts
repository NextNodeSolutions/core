import { describe, expect, it } from 'vitest'

import { validateObservabilityService } from './observability.ts'

const VALID = {
	logs_retention: '30d',
	metrics_retention_months: 12,
	logs_vhost: 'logs.monitoring.nextnode.fr',
	metrics_vhost: 'metrics.monitoring.nextnode.fr',
}

describe('validateObservabilityService', () => {
	it('accepts the canonical monitoring block', () => {
		const validation = validateObservabilityService(VALID)
		expect(validation).toEqual({
			ok: true,
			section: {
				logsRetention: '30d',
				metricsRetentionMonths: 12,
				logsVhost: 'logs.monitoring.nextnode.fr',
				metricsVhost: 'metrics.monitoring.nextnode.fr',
			},
		})
	})

	it('rejects a non-table value', () => {
		const validation = validateObservabilityService('yes')
		expect(validation).toEqual({
			ok: false,
			errors: ['[services.observability] must be a table'],
		})
	})

	it('rejects a malformed retention duration', () => {
		const validation = validateObservabilityService({
			...VALID,
			logs_retention: '30 days',
		})
		expect(validation.ok).toBe(false)
		if (!validation.ok) {
			expect(validation.errors[0]).toContain('logs_retention')
		}
	})

	it('rejects a non-integer metrics retention', () => {
		const validation = validateObservabilityService({
			...VALID,
			metrics_retention_months: 1.5,
		})
		expect(validation.ok).toBe(false)
	})

	it('collects every field error in one pass', () => {
		const validation = validateObservabilityService({})
		expect(validation.ok).toBe(false)
		if (!validation.ok) {
			expect(validation.errors).toHaveLength(4)
		}
	})
})
