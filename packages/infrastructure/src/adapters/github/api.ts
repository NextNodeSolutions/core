import { fetchBounded } from '#/adapters/http/fetch.ts'
import { parseJsonOrThrow } from '#/kernel/json.ts'

import type { WorkflowRun } from '#/domain/pipeline/prod-gate.ts'

export async function fetchWorkflowRuns(
	repo: string,
	sha: string,
	token: string,
): Promise<ReadonlyArray<WorkflowRun>> {
	const operation = `GitHub API: list the workflow runs of ${repo} at ${sha}`
	const response = await fetchBounded(
		`https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`,
		{
			operation,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
			},
		},
	)

	if (!response.ok) {
		throw new Error(
			`GitHub API returned ${response.status}: ${response.body}`,
		)
	}

	const responseBody = parseJsonOrThrow(response.body, operation)
	if (
		typeof responseBody !== 'object' ||
		responseBody === null ||
		!('workflow_runs' in responseBody) ||
		!Array.isArray(responseBody.workflow_runs)
	) {
		throw new Error('GitHub API response missing workflow_runs array')
	}
	return responseBody.workflow_runs
}
