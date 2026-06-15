import { afterEach, describe, expect, it, vi } from 'vitest'

import { GithubMalformedResponseError } from '@/lib/adapters/github/client.ts'
import { getLatestWorkflowRun } from '@/lib/adapters/github/workflow-runs.ts'

const jsonResponse = (body: unknown): Response =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('getLatestWorkflowRun malformed-response handling', () => {
	it('throws when the 200 payload lacks the workflow_runs array', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(jsonResponse({ message: 'Server Error' })),
			),
		)

		await expect(
			getLatestWorkflowRun('token-wr', 'org/repo-malformed'),
		).rejects.toBeInstanceOf(GithubMalformedResponseError)
	})

	it('returns null when workflow_runs is a legitimate empty array', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(jsonResponse({ workflow_runs: [] }))),
		)

		await expect(
			getLatestWorkflowRun('token-wr', 'org/repo-empty'),
		).resolves.toBeNull()
	})
})
