import { isRecord } from '#/kernel/guards.ts'

/**
 * Request the job's GitHub Actions OIDC token: a short-lived JWT signed by
 * GitHub that proves which repository and workflow is running. It is what the
 * pipeline trades for vault access, so no long-lived credential is stored
 * anywhere. The runner only exposes the request endpoint to a job granted
 * `permissions: id-token: write`.
 */
export async function requestGithubOidcToken(
	audience: string,
): Promise<string> {
	const requestUrl = process.env['ACTIONS_ID_TOKEN_REQUEST_URL']
	const requestToken = process.env['ACTIONS_ID_TOKEN_REQUEST_TOKEN']
	if (!requestUrl || !requestToken) {
		throw new Error(
			'GitHub OIDC token endpoint is not available - the job must declare `permissions: id-token: write`',
		)
	}

	const url = new URL(requestUrl)
	url.searchParams.set('audience', audience)
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${requestToken}` },
	})
	if (!response.ok) {
		throw new Error(
			`GitHub OIDC token request returned ${response.status}: ${await response.text()}`,
		)
	}

	const responseBody: unknown = await response.json()
	if (!isRecord(responseBody) || typeof responseBody['value'] !== 'string') {
		throw new Error('GitHub OIDC token response is missing `value`')
	}
	return responseBody['value']
}
