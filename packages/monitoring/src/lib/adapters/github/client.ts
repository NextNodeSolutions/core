import { UpstreamApiFailure } from '@/lib/adapters/upstream-api-failure.ts'

export const GITHUB_API_BASE = 'https://api.github.com'
export const GITHUB_ORG_LOGIN = 'NextNodeSolutions'

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

export const githubGet = async (
	path: string,
	token: string,
	context: string,
): Promise<unknown> => {
	const response = await fetch(`${GITHUB_API_BASE}${path}`, {
		headers: authHeaders(token),
	})
	if (!response.ok) {
		const body = await response.text()
		throw new GithubApiFailure(context, response.status, body)
	}
	return response.json()
}
