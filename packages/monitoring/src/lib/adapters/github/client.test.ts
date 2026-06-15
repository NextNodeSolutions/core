import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	GithubApiFailure,
	GithubRateLimitError,
	githubGet,
} from '@/lib/adapters/github/client.ts'

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('githubGet timeout', () => {
	it('aborts and rejects once the timeout elapses on a hung upstream', async () => {
		// A fetch that hangs forever unless its abort signal fires; it only
		// rejects when the signal aborts, proving the timeout wired the
		// AbortController into the request.
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url: string, init?: { signal?: AbortSignal }) =>
					new Promise((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => {
							reject(new Error('aborted by signal'))
						})
					}),
			),
		)

		const pending = githubGet('/orgs/x/repos', 'token', 'org repos')
		const assertion = expect(pending).rejects.toThrow()
		await vi.runAllTimersAsync()
		await assertion
	})
})

const RATE_LIMIT_RESET = 1718000000

const stubResponse = (
	status: number,
	headers: Record<string, string>,
	body: unknown,
): void => {
	vi.stubGlobal(
		'fetch',
		vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify(body), {
					status,
					headers,
				}),
			),
		),
	)
}

describe('githubGet rate-limit detection', () => {
	it('raises GithubRateLimitError on 403 with x-ratelimit-remaining: 0', async () => {
		vi.useRealTimers()
		stubResponse(
			403,
			{
				'x-ratelimit-remaining': '0',
				'x-ratelimit-reset': String(RATE_LIMIT_RESET),
			},
			{ message: 'API rate limit exceeded' },
		)

		const error = await githubGet(
			'/orgs/x/repos',
			'token',
			'org repos',
		).catch((caught: unknown) => caught)

		expect(error).toBeInstanceOf(GithubRateLimitError)
		expect(error).not.toBeInstanceOf(GithubApiFailure)
		if (error instanceof GithubRateLimitError) {
			expect(error.resetSeconds).toBe(RATE_LIMIT_RESET)
		}
	})

	it('raises GithubRateLimitError on 429 carrying retry-after', async () => {
		vi.useRealTimers()
		stubResponse(
			429,
			{ 'retry-after': '60' },
			{ message: 'Too Many Requests' },
		)

		const error = await githubGet(
			'/orgs/x/repos',
			'token',
			'org repos',
		).catch((caught: unknown) => caught)

		expect(error).toBeInstanceOf(GithubRateLimitError)
	})

	it('raises a plain GithubApiFailure (not rate-limit) on a 401 auth failure', async () => {
		vi.useRealTimers()
		stubResponse(401, {}, { message: 'Bad credentials' })

		const error = await githubGet(
			'/orgs/x/repos',
			'token',
			'org repos',
		).catch((caught: unknown) => caught)

		expect(error).toBeInstanceOf(GithubApiFailure)
		expect(error).not.toBeInstanceOf(GithubRateLimitError)
	})

	it('raises a plain GithubApiFailure on a 403 that is not rate-limited', async () => {
		vi.useRealTimers()
		stubResponse(
			403,
			{ 'x-ratelimit-remaining': '12' },
			{ message: 'Resource not accessible' },
		)

		const error = await githubGet(
			'/orgs/x/repos',
			'token',
			'org repos',
		).catch((caught: unknown) => caught)

		expect(error).toBeInstanceOf(GithubApiFailure)
		expect(error).not.toBeInstanceOf(GithubRateLimitError)
	})
})
