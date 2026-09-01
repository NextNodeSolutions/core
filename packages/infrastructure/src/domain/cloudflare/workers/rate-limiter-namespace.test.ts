import { describe, expect, it } from 'vitest'

import { computeRateLimiterNamespaceId } from './rate-limiter-namespace.ts'

describe('computeRateLimiterNamespaceId', () => {
	it('pins the FNV-1a hash of project/environment/worker/limiter', () => {
		expect(
			computeRateLimiterNamespaceId('proj', 'production', 'api', 'forms'),
		).toBe('3552928083')
	})

	it('separates two limiters whose dash-joined names would read the same', () => {
		expect(
			computeRateLimiterNamespaceId(
				'proj',
				'production',
				'api',
				'forms-v2',
			),
		).not.toBe(
			computeRateLimiterNamespaceId(
				'proj',
				'production',
				'api-forms',
				'v2',
			),
		)
	})

	it('returns the same id for the same inputs', () => {
		const first = computeRateLimiterNamespaceId(
			'proj',
			'production',
			'api',
			'forms',
		)
		const second = computeRateLimiterNamespaceId(
			'proj',
			'production',
			'api',
			'forms',
		)

		expect(second).toBe(first)
	})

	it('separates the counters of two environments', () => {
		expect(
			computeRateLimiterNamespaceId(
				'proj',
				'development',
				'api',
				'forms',
			),
		).not.toBe(
			computeRateLimiterNamespaceId('proj', 'production', 'api', 'forms'),
		)
	})
})
