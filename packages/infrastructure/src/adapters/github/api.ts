import type { WorkflowRun } from '../../domain/pipeline/prod-gate.ts'

export async function fetchWorkflowRuns(
	repo: string,
	sha: string,
	token: string,
): Promise<ReadonlyArray<WorkflowRun>> {
	const response = await fetch(
		`https://api.github.com/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`,
		{
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
			},
		},
	)

	if (!response.ok) {
		throw new Error(
			`GitHub API returned ${response.status}: ${await response.text()}`,
		)
	}

	const data: unknown = await response.json()
	if (
		typeof data !== 'object' ||
		data === null ||
		!('workflow_runs' in data) ||
		!Array.isArray(data.workflow_runs)
	) {
		throw new Error('GitHub API response missing workflow_runs array')
	}
	return data.workflow_runs
}
