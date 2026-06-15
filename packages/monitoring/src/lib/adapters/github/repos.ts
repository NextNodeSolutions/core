import { createHash } from 'node:crypto'

import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import {
	GITHUB_ORG_LOGIN,
	GithubMalformedResponseError,
	githubGet,
} from '@/lib/adapters/github/client.ts'
import { isRecord } from '@/lib/domain/is-record.ts'
import { parseStringOrNull } from '@/lib/domain/parse-string.ts'

import type { GithubRepo } from '@/lib/domain/github/github-project.ts'

const REPOS_TTL_MS = 60_000
const REPOS_PER_PAGE = 100

const parseRepo = (raw: unknown): GithubRepo | null => {
	if (!isRecord(raw)) return null
	if (typeof raw.name !== 'string' || typeof raw.full_name !== 'string') {
		return null
	}
	return {
		name: raw.name,
		fullName: raw.full_name,
		isPrivate: raw.private === true,
		description: parseStringOrNull(raw.description),
		defaultBranch:
			typeof raw.default_branch === 'string'
				? raw.default_branch
				: 'main',
		htmlUrl:
			typeof raw.html_url === 'string'
				? raw.html_url
				: `https://github.com/${raw.full_name}`,
		archived: raw.archived === true,
		pushedAt: parseStringOrNull(raw.pushed_at),
	}
}

const fetchOrgRepos = async (
	token: string,
): Promise<ReadonlyArray<GithubRepo>> => {
	const context = `GitHub org "${GITHUB_ORG_LOGIN}" repos`
	const payload = await githubGet(
		`/orgs/${GITHUB_ORG_LOGIN}/repos?per_page=${String(REPOS_PER_PAGE)}&sort=pushed`,
		token,
		context,
	)
	if (!Array.isArray(payload)) {
		// A non-array 200 is a malformed response (incident / error JSON),
		// not an empty repo set - surface it rather than reporting zero repos.
		throw new GithubMalformedResponseError(
			context,
			'expected a JSON array of repos',
		)
	}
	return payload
		.map(parseRepo)
		.filter((repo): repo is GithubRepo => repo !== null)
}

/**
 * Cache key for a token: the sha256 digest, never the raw secret. The
 * cached value is keyed per credential, but the credential itself must not
 * sit in the LRU as a plain-text index (where a heap dump or cache
 * inspection would leak it).
 */
export const cacheKeyForToken = (token: string): string =>
	createHash('sha256').update(token).digest('hex')

const memoizedListOrgRepos = keyedMemoizeAsync(
	REPOS_TTL_MS,
	cacheKeyForToken,
	fetchOrgRepos,
)

export const listOrgRepos = (
	token: string,
): Promise<ReadonlyArray<GithubRepo>> => memoizedListOrgRepos(token)
