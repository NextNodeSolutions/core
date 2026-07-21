import { UpstreamApiFailure } from '@/lib/adapters/upstream-api-failure.ts'

export const GITHUB_API_BASE = 'https://api.github.com'
export const GITHUB_ORG_LOGIN = 'NextNodeSolutions'

/** Bound every request so a hung GitHub API cannot wedge a page render. */
const GITHUB_TIMEOUT_MS = 5000

/** A malformed body still arrives with a 200 status. */
const HTTP_OK = 200

/** GitHub returns 403 (primary limit) or 429 (secondary limit) when throttled. */
const HTTP_FORBIDDEN = 403
const HTTP_TOO_MANY_REQUESTS = 429

export class GithubApiFailure extends UpstreamApiFailure {
	constructor(
		context: string,
		httpStatus: number,
		public readonly body: string,
	) {
		super(
			context,
			httpStatus,
			`${context} failed (HTTP ${String(httpStatus)}): ${body || 'no detail'}`,
		)
	}

	logContext(): Record<string, unknown> {
		return { body: this.body }
	}
}

/**
 * A 200 from GitHub whose body is not the shape the endpoint contracts -
 * a non-array repo list, a missing `workflow_runs`, etc. GitHub returns
 * this during incidents (200 + an error/status JSON object). Swallowing it
 * as an empty result would silently hide an outage, so we surface it as an
 * explicit shape failure to be logged and propagated.
 */
export class GithubMalformedResponseError extends UpstreamApiFailure {
	constructor(
		context: string,
		public readonly detail: string,
	) {
		super(context, HTTP_OK, `${context}: ${detail}`)
	}

	logContext(): Record<string, unknown> {
		return { detail: this.detail }
	}
}

/**
 * A throttled GitHub response (primary or secondary rate limit), kept
 * distinct from auth/shape failures so the caller never confuses "slow
 * down" with "wrong token". `resetSeconds` is the unix epoch the primary
 * limit refills at (from `x-ratelimit-reset`), null for a secondary limit
 * that only carries `retry-after`.
 */
export class GithubRateLimitError extends UpstreamApiFailure {
	constructor(
		context: string,
		httpStatus: number,
		public readonly resetSeconds: number | null,
		public readonly retryAfterSeconds: number | null,
	) {
		super(
			context,
			httpStatus,
			`${context} hit GitHub rate limit (HTTP ${String(httpStatus)})`,
		)
	}

	logContext(): Record<string, unknown> {
		return {
			resetSeconds: this.resetSeconds,
			retryAfterSeconds: this.retryAfterSeconds,
		}
	}
}

const parseHeaderInt = (raw: string | null): number | null => {
	if (raw === null) return null
	const parsed = Number(raw)
	if (Number.isInteger(parsed)) return parsed
	return null
}

/**
 * A throttled response is a 403/429 that either reports zero remaining
 * primary budget or carries a `retry-after` (secondary limit). A 403 with
 * budget left is a real authorization failure, not a rate limit.
 */
const isRateLimited = (response: Response): boolean => {
	if (
		response.status !== HTTP_FORBIDDEN &&
		response.status !== HTTP_TOO_MANY_REQUESTS
	) {
		return false
	}
	const remaining = parseHeaderInt(
		response.headers.get('x-ratelimit-remaining'),
	)
	return remaining === 0 || response.headers.has('retry-after')
}

const authHeaders = (token: string): Record<string, string> => ({
	Authorization: `Bearer ${token}`,
	Accept: 'application/vnd.github+json',
	'X-GitHub-Api-Version': '2022-11-28',
	'User-Agent': 'nextnode-monitoring',
})

const fetchWithTimeout = async (
	url: string,
	token: string,
	context: string,
): Promise<Response> => {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS)
	try {
		return await fetch(url, {
			headers: authHeaders(token),
			signal: controller.signal,
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		// A connection refused / timeout abort is an upstream failure,
		// surfaced as a degraded panel rather than a 500 page.
		throw new GithubApiFailure(context, 0, message)
	} finally {
		clearTimeout(timer)
	}
}

const assertSuccessful = async (
	response: Response,
	context: string,
): Promise<void> => {
	if (isRateLimited(response)) {
		throw new GithubRateLimitError(
			context,
			response.status,
			parseHeaderInt(response.headers.get('x-ratelimit-reset')),
			parseHeaderInt(response.headers.get('retry-after')),
		)
	}
	if (!response.ok) {
		const body = await response.text()
		throw new GithubApiFailure(context, response.status, body)
	}
}

export const githubGet = async (
	path: string,
	token: string,
	context: string,
): Promise<unknown> => {
	const response = await fetchWithTimeout(
		`${GITHUB_API_BASE}${path}`,
		token,
		context,
	)
	await assertSuccessful(response, context)
	return response.json()
}

/** Match the `<url>; rel="next"` member of a GitHub `Link` header. */
const NEXT_LINK_PATTERN = /<(?<nextUrl>[^>]+)>;\s*rel="next"/

/**
 * Extract the next-page path from a GitHub `Link` header. GitHub paginates
 * list endpoints and advertises the next page via `Link: <url>; rel="next"`;
 * we return the path (everything after the API base) so the caller can feed
 * it straight back to githubGetPaged, and null once the header drops `next`
 * (the last page).
 */
const parseNextPath = (linkHeader: string | null): string | null => {
	if (linkHeader === null) return null
	const match = NEXT_LINK_PATTERN.exec(linkHeader)
	const nextUrl = match?.groups?.nextUrl
	if (typeof nextUrl === 'undefined') return null
	return nextUrl.startsWith(GITHUB_API_BASE)
		? nextUrl.slice(GITHUB_API_BASE.length)
		: nextUrl
}

export interface GithubPage {
	readonly payload: unknown
	readonly nextPath: string | null
}

/**
 * Like githubGet but also surfaces the `Link: rel="next"` path so a caller
 * can walk every page of a paginated list endpoint to completion instead of
 * silently truncating at the first page.
 */
export const githubGetPaged = async (
	path: string,
	token: string,
	context: string,
): Promise<GithubPage> => {
	const response = await fetchWithTimeout(
		`${GITHUB_API_BASE}${path}`,
		token,
		context,
	)
	await assertSuccessful(response, context)
	return {
		payload: await response.json(),
		nextPath: parseNextPath(response.headers.get('link')),
	}
}
