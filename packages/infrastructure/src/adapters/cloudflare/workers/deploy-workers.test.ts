import { httpError, okEmpty } from '#/test-fetch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deployWorkers } from './deploy-workers.ts'

import type { ExecResult, WranglerRunner } from '#/adapters/wrangler/runner.ts'
import type { WorkerServiceConfig } from '#/config/types.ts'
import type { FetchImpl } from '#/test-fetch.ts'
import type { WorkersDeployInput } from './deploy-workers.ts'

const ok: ExecResult = { exitCode: 0, stdout: '', stderr: '' }

const worker = (
	overrides: Partial<WorkerServiceConfig> = {},
): WorkerServiceConfig => ({
	secrets: [],
	needs: [],
	dependsOn: [],
	entry: 'dist/_worker.js/index.js',
	...overrides,
})

function buildInput(
	services: Record<string, WorkerServiceConfig>,
	runner: WranglerRunner,
): WorkersDeployInput {
	return {
		projectName: 'my-worker',
		environment: 'production',
		domain: 'example.com',
		services,
		backingServices: {},
		cron: [],
		outputs: {
			kvNamespaceIds: {},
			queueIds: {},
			r2Buckets: {},
			r2CdnUrls: {},
		},
		secrets: {},
		secretOrigins: {},
		accountId: 'acct-123',
		wranglerRunner: runner,
		projectDir: '/project/app',
		// Skip the retry backoff so an exhausted smoke check fails immediately.
		smokeCheckSleep: () => Promise.resolve(),
	}
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('deployWorkers smoke check', () => {
	it('fails the deploy when a routed service never passes /healthz', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn<FetchImpl>(() =>
				Promise.resolve(httpError(503, 'still starting')),
			),
		)
		const runner = vi.fn<WranglerRunner>(() => Promise.resolve(ok))

		await expect(
			deployWorkers(
				buildInput({ web: worker({ url: 'example.com' }) }, runner),
			),
		).rejects.toThrow(/service "web".*HTTP 503 - still starting/s)
	})

	it('resolves when every routed service passes /healthz', async () => {
		const fetchMock = vi.fn<FetchImpl>(() => Promise.resolve(okEmpty()))
		vi.stubGlobal('fetch', fetchMock)
		const runner = vi.fn<WranglerRunner>(() => Promise.resolve(ok))

		const deployResult = await deployWorkers(
			buildInput(
				{ web: worker({ url: 'example.com' }), queue: worker() },
				runner,
			),
		)

		expect(deployResult.projectName).toBe('my-worker')
		expect(fetchMock).toHaveBeenCalledTimes(1)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://example.com/healthz',
			expect.objectContaining({ method: 'GET' }),
		)
	})
})
