import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { GithubMalformedResponseError } from '@/lib/adapters/github/client.ts'
import { cacheKeyForToken, listOrgRepos } from '@/lib/adapters/github/repos.ts'

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

describe('cacheKeyForToken', () => {
	it('hashes the token with sha256 instead of indexing on the raw secret', () => {
		const token = 'ghp_supersecret'
		const key = cacheKeyForToken(token)

		expect(key).not.toBe(token)
		expect(key).not.toContain(token)
		expect(key).toBe(createHash('sha256').update(token).digest('hex'))
	})

	it('is deterministic so the same token still hits the cache', () => {
		expect(cacheKeyForToken('ghp_x')).toBe(cacheKeyForToken('ghp_x'))
	})
})

describe('listOrgRepos caching', () => {
	it('serves a second call from cache (one upstream fetch per token)', async () => {
		const fetchSpy = vi.fn(() =>
			Promise.resolve(jsonResponse([{ name: 'r', full_name: 'org/r' }])),
		)
		vi.stubGlobal('fetch', fetchSpy)

		await listOrgRepos('token-cache-hit')
		await listOrgRepos('token-cache-hit')

		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})
})
