import { httpError, okEmpty } from '#/test-fetch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SMOKE_CHECK_MAX_ATTEMPTS, smokeCheckWorkers } from './smoke-check.ts'

import type { SmokeCheckTarget } from '#/domain/cloudflare/workers/smoke-check.ts'
import type { FetchImpl } from '#/test-fetch.ts'

const WEB: SmokeCheckTarget = {
	service: 'web',
	url: 'https://example.com/healthz',
}

// No real backoff between retries; the delay is a production timer, not a test
// concern.
const NO_SLEEP = { sleep: (): Promise<void> => Promise.resolve() }

function stubFetch(impl: FetchImpl): ReturnType<typeof vi.fn<FetchImpl>> {
	const mock = vi.fn<FetchImpl>(impl)
	vi.stubGlobal('fetch', mock)
	return mock
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('smokeCheckWorkers', () => {
	it('resolves when every routed service answers 2xx on the first try', async () => {
		const mock = stubFetch(() => Promise.resolve(okEmpty()))

		await smokeCheckWorkers(
			[WEB, { service: 'api', url: 'https://api.example.com/healthz' }],
			NO_SLEEP,
		)

		expect(mock).toHaveBeenCalledTimes(2)
		expect(mock).toHaveBeenCalledWith(
			'https://example.com/healthz',
			expect.objectContaining({ method: 'GET' }),
		)
	})

	it('throws with the status and body after exhausting retries on a non-2xx', async () => {
		const mock = stubFetch(() =>
			Promise.resolve(httpError(503, 'service unavailable')),
		)

		await expect(smokeCheckWorkers([WEB], NO_SLEEP)).rejects.toThrow(
			/service "web".*HTTP 503 - service unavailable/s,
		)
		expect(mock).toHaveBeenCalledTimes(SMOKE_CHECK_MAX_ATTEMPTS)
	})

	it('retries a transient failure and resolves once the service is healthy', async () => {
		const mock = stubFetch(() => Promise.resolve(okEmpty()))
		mock.mockResolvedValueOnce(
			httpError(503, 'warming up'),
		).mockResolvedValueOnce(httpError(503, 'warming up'))

		await smokeCheckWorkers([WEB], NO_SLEEP)

		expect(mock).toHaveBeenCalledTimes(3)
	})

	it('throws with the network error when the service stays unreachable', async () => {
		const mock = stubFetch(() =>
			Promise.reject(new Error('getaddrinfo ENOTFOUND example.com')),
		)

		await expect(smokeCheckWorkers([WEB], NO_SLEEP)).rejects.toThrow(
			/getaddrinfo ENOTFOUND example.com/,
		)
		expect(mock).toHaveBeenCalledTimes(SMOKE_CHECK_MAX_ATTEMPTS)
	})

	it('does nothing when there are no routed services', async () => {
		const mock = stubFetch(() => Promise.resolve(okEmpty()))

		await smokeCheckWorkers([], NO_SLEEP)

		expect(mock).not.toHaveBeenCalled()
	})
})
