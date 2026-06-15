import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import {
	GithubMalformedResponseError,
	githubGet,
} from '@/lib/adapters/github/client.ts'
import { isRecord } from '@/lib/domain/is-record.ts'
import { parseStringOrNull } from '@/lib/domain/parse-string.ts'

import type { GithubRun } from '@/lib/domain/github/github-project.ts'

const RUNS_TTL_MS = 30_000

const parseRun = (raw: unknown): GithubRun | null => {
	if (!isRecord(raw)) return null
	if (typeof raw.status !== 'string' || typeof raw.created_at !== 'string') {
		return null
	}
	return {
		status: raw.status,
		conclusion: parseStringOrNull(raw.conclusion),
		createdAt: raw.created_at,
		headSha: typeof raw.head_sha === 'string' ? raw.head_sha : '',
		htmlUrl: typeof raw.html_url === 'string' ? raw.html_url : '',
	}
}

const fetchLatestRun = async (input: {
	readonly token: string
	readonly fullName: string
}): Promise<GithubRun | null> => {
	const context = `GitHub latest run for "${input.fullName}"`
	const payload = await githubGet(
		`/repos/${input.fullName}/actions/runs?per_page=1`,
		input.token,
		context,
	)
	if (!isRecord(payload) || !Array.isArray(payload.workflow_runs)) {
		// A 200 without the contracted `workflow_runs` array is malformed
		// (incident / error JSON), not "no runs" - surface it. An empty
		// `workflow_runs: []` is a legitimate "no runs yet" and stays null.
		throw new GithubMalformedResponseError(
			context,
			'expected a `workflow_runs` array',
		)
	}
	const [first] = payload.workflow_runs
	return parseRun(first)
}

const memoizedLatestRun = keyedMemoizeAsync(
	RUNS_TTL_MS,
	(input: { token: string; fullName: string }) => input.fullName,
	fetchLatestRun,
)

export const getLatestWorkflowRun = (
	token: string,
	fullName: string,
): Promise<GithubRun | null> => memoizedLatestRun({ token, fullName })
