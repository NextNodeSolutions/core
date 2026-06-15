import { UpstreamApiFailure } from '@/lib/adapters/upstream-api-failure.ts'

export const GITHUB_API_BASE = 'https://api.github.com'
export const GITHUB_ORG_LOGIN = 'NextNodeSolutions'

/** Bound every request so a hung GitHub API cannot wedge a page render. */
const GITHUB_TIMEOUT_MS = 5000

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
	if (!response.ok) {
		const body = await response.text()
		throw new GithubApiFailure(context, response.status, body)
	}
	return response.json()
}
