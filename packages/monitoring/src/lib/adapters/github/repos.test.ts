import { afterEach, describe, expect, it, vi } from 'vitest'

import { GithubMalformedResponseError } from '@/lib/adapters/github/client.ts'
import { listOrgRepos } from '@/lib/adapters/github/repos.ts'

const jsonResponse = (
	body: unknown,
	headers: Record<string, string> = {},
): Response =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json', ...headers },
	})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe('listOrgRepos malformed-response handling', () => {
	it('throws on a 200 carrying a non-array payload (incident / error JSON)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() =>
				Promise.resolve(jsonResponse({ message: 'Bad credentials' })),
			),
		)

		await expect(listOrgRepos('token-malformed')).rejects.toBeInstanceOf(
			GithubMalformedResponseError,
		)
	})

	it('treats a legitimate empty array as a valid empty result', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(jsonResponse([]))),
		)

		await expect(listOrgRepos('token-empty')).resolves.toEqual([])
	})
})
