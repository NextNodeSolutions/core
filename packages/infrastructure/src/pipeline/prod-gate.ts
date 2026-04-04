import { logger } from '@nextnode-solutions/logger'

const DEV_WORKFLOW_PATH = '.github/workflows/deploy-dev.yml'

interface WorkflowRun {
	readonly path: string
	readonly status: string
	readonly conclusion: string | null
	readonly html_url: string
}

interface WorkflowRunsResponse {
	readonly total_count: number
	readonly workflow_runs: ReadonlyArray<WorkflowRun>
}

export function findDevRun(
	runs: ReadonlyArray<WorkflowRun>,
): WorkflowRun | undefined {
	return runs.find(run => run.path === DEV_WORKFLOW_PATH)
}

async function fetchWorkflowRuns(
	repo: string,
	sha: string,
	token: string,
): Promise<WorkflowRunsResponse> {
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

	return (await response.json()) as WorkflowRunsResponse
}

export async function prodGate(): Promise<void> {
	const repo = process.env['GITHUB_REPOSITORY']
	const sha = process.env['GITHUB_SHA']
	const token = process.env['GH_TOKEN']

	if (!repo) throw new Error('GITHUB_REPOSITORY env var is required')
	if (!sha) throw new Error('GITHUB_SHA env var is required')
	if (!token) throw new Error('GH_TOKEN env var is required')

	logger.info(`Checking dev pipeline status for ${sha}...`)

	const data = await fetchWorkflowRuns(repo, sha, token)
	const devRun = findDevRun(data.workflow_runs)

	if (!devRun) {
		throw new Error(
			`No dev pipeline run found for ${sha}. Deploy to development first.`,
		)
	}

	if (devRun.status !== 'completed' || devRun.conclusion !== 'success') {
		throw new Error(
			`Dev pipeline has not passed: ${devRun.status}/${devRun.conclusion} (${devRun.html_url})`,
		)
	}

	logger.info(`Prod gate passed: dev pipeline succeeded for ${sha}`)
}
