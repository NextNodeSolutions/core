import { logger } from '@nextnode-solutions/logger'

interface CheckRun {
	readonly name: string
	readonly status: string
	readonly conclusion: string | null
}

interface CheckRunsResponse {
	readonly check_runs: ReadonlyArray<CheckRun>
}

interface GateResult {
	readonly total: number
	readonly passed: number
	readonly failed: ReadonlyArray<CheckRun>
}

export function evaluateDevRuns(
	checkRuns: ReadonlyArray<CheckRun>,
): GateResult {
	const devRuns = checkRuns.filter(run => run.name.includes('app-dev'))

	const passed = devRuns.filter(
		run => run.status === 'completed' && run.conclusion === 'success',
	)

	const failed = devRuns.filter(
		run => run.status !== 'completed' || run.conclusion !== 'success',
	)

	return { total: devRuns.length, passed: passed.length, failed }
}

async function fetchCheckRuns(
	repo: string,
	sha: string,
	token: string,
): Promise<CheckRunsResponse> {
	const response = await fetch(
		`https://api.github.com/repos/${repo}/commits/${sha}/check-runs?per_page=100`,
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

	return (await response.json()) as CheckRunsResponse
}

export async function prodGate(): Promise<void> {
	const repo = process.env['GITHUB_REPOSITORY']
	const sha = process.env['GITHUB_SHA']
	const token = process.env['GH_TOKEN']

	if (!repo) throw new Error('GITHUB_REPOSITORY env var is required')
	if (!sha) throw new Error('GITHUB_SHA env var is required')
	if (!token) throw new Error('GH_TOKEN env var is required')

	logger.info(`Checking dev pipeline status for ${sha}...`)

	const data = await fetchCheckRuns(repo, sha, token)
	const result = evaluateDevRuns(data.check_runs)

	if (result.total === 0) {
		throw new Error(
			`No dev pipeline runs found for ${sha}. Deploy to development first.`,
		)
	}

	if (result.passed !== result.total) {
		const failDetails = result.failed
			.map(run => `  ${run.name}: ${run.status}/${run.conclusion}`)
			.join('\n')
		throw new Error(
			`Dev pipeline has not fully passed (${result.passed}/${result.total} checks succeeded)\n${failDetails}`,
		)
	}

	logger.info(
		`Prod gate passed: ${result.passed}/${result.total} dev checks succeeded for ${sha}`,
	)
}
