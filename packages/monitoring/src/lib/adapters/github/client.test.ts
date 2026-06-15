import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { githubGet } from '@/lib/adapters/github/client.ts'

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
