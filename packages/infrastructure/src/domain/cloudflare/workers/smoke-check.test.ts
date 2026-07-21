import { describe, expect, it } from 'vitest'

import { computeSmokeCheckUrls } from './smoke-check.ts'

import type { WorkerServiceConfig } from '#/config/types.ts'

const worker = (
	overrides: Partial<WorkerServiceConfig> = {},
): WorkerServiceConfig => ({
	secrets: [],
	needs: [],
	dependsOn: [],
	entry: 'dist/_worker.js/index.js',
	...overrides,
})

describe('computeSmokeCheckUrls', () => {
	it('emits a /healthz URL per routed service in production', () => {
		const targets = computeSmokeCheckUrls(
			{
				web: worker({ url: 'example.com' }),
				api: worker({ url: 'api.example.com' }),
			},
			'production',
		)

		expect(targets).toEqual([
			{ service: 'web', url: 'https://example.com/healthz' },
			{ service: 'api', url: 'https://api.example.com/healthz' },
		])
	})

	it('resolves the dev subdomain in development', () => {
		const targets = computeSmokeCheckUrls(
			{ web: worker({ url: 'example.com' }) },
			'development',
		)

		expect(targets).toEqual([
			{ service: 'web', url: 'https://dev.example.com/healthz' },
		])
	})

	it('skips services with no url (not routed)', () => {
		const targets = computeSmokeCheckUrls(
			{
				web: worker({ url: 'example.com' }),
				queue: worker(),
			},
			'production',
		)

		expect(targets).toEqual([
			{ service: 'web', url: 'https://example.com/healthz' },
		])
	})

	it('returns an empty list when no service is routed', () => {
		expect(
			computeSmokeCheckUrls({ queue: worker() }, 'production'),
		).toEqual([])
	})
})
