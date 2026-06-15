import { createHash } from 'node:crypto'

import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import {
	GITHUB_ORG_LOGIN,
	GithubMalformedResponseError,
	githubGetPaged,
} from '@/lib/adapters/github/client.ts'
import { isRecord } from '@/lib/domain/is-record.ts'
import { parseStringOrNull } from '@/lib/domain/parse-string.ts'

import type { GithubRepo } from '@/lib/domain/github/github-project.ts'

const REPOS_TTL_MS = 60_000
const REPOS_PER_PAGE = 100
// Defensive ceiling on the Link-walk so a server that keeps advertising a
// `next` page can never spin forever (100 pages = 10k repos, far past the org).
const MAX_REPO_PAGES = 100

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

const parseRepoPage = (
	payload: unknown,
	context: string,
): ReadonlyArray<GithubRepo> => {
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

const fetchOrgRepos = async (
	token: string,
): Promise<ReadonlyArray<GithubRepo>> => {
	const context = `GitHub org "${GITHUB_ORG_LOGIN}" repos`
	const repos: Array<GithubRepo> = []
	let nextPath: string | null =
		`/orgs/${GITHUB_ORG_LOGIN}/repos?per_page=${String(REPOS_PER_PAGE)}&sort=pushed`
	// Follow the Link rel="next" chain so an org with >100 repos is not
	// silently truncated at the first page. Sequential by necessity: each
	// page's `nextPath` is only known once the previous page has resolved.
	for (
		let pageNumber = 0;
		nextPath !== null && pageNumber < MAX_REPO_PAGES;
		pageNumber++
	) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- each page reveals the next one
		const { payload, nextPath: followingPath } = await githubGetPaged(
			nextPath,
			token,
			context,
		)
		repos.push(...parseRepoPage(payload, context))
		nextPath = followingPath
	}
	return repos
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
