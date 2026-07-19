import { keyedMemoizeAsync } from '@/lib/adapters/cache.ts'
import {
	GithubMalformedResponseError,
	githubGet,
} from '@/lib/adapters/github/client.ts'
import { isRecord } from '@/lib/domain/is-record.ts'
import { parseStringOrNull } from '@/lib/domain/parse-string.ts'

/**
 * The latest runs of ONE workflow, raw from the runs API. The repo-level
 * orchestrator (vps-deployments.ts) joins them with the repo record to build
 * the domain VpsDeployRun (the environment rule needs the default branch).
 */

const RUNS_TTL_MS = 30_000

export interface RawDeployRun {
	readonly id: string
	readonly workflowName: string
	readonly displayTitle: string
	readonly status: string
	readonly conclusion: string | null
	readonly headBranch: string | null
	readonly headSha: string
	readonly htmlUrl: string
	readonly createdAt: string
}

const parseDeployRun = (raw: unknown): RawDeployRun | null => {
	if (!isRecord(raw)) return null
	if (
		typeof raw.id !== 'number' ||
		typeof raw.status !== 'string' ||
		typeof raw.created_at !== 'string'
	) {
		return null
	}
	return {
		id: String(raw.id),
		workflowName: typeof raw.name === 'string' ? raw.name : '',
		displayTitle:
			typeof raw.display_title === 'string' ? raw.display_title : '',
		status: raw.status,
		conclusion: parseStringOrNull(raw.conclusion),
		headBranch: parseStringOrNull(raw.head_branch),
		headSha: typeof raw.head_sha === 'string' ? raw.head_sha : '',
		htmlUrl: typeof raw.html_url === 'string' ? raw.html_url : '',
		createdAt: raw.created_at,
	}
}

const fetchDeployRuns = async (input: {
	readonly token: string
	readonly fullName: string
	readonly workflowId: number
	readonly limit: number
}): Promise<ReadonlyArray<RawDeployRun>> => {
	const context = `GitHub runs for "${input.fullName}" workflow ${String(input.workflowId)}`
	const payload = await githubGet(
		`/repos/${input.fullName}/actions/workflows/${String(input.workflowId)}/runs?per_page=${String(input.limit)}`,
		input.token,
		context,
	)
	if (!isRecord(payload) || !Array.isArray(payload.workflow_runs)) {
		throw new GithubMalformedResponseError(
			context,
			'expected a `workflow_runs` array',
		)
	}
	return payload.workflow_runs
		.map(parseDeployRun)
		.filter((run): run is RawDeployRun => run !== null)
}

const memoizedDeployRuns = keyedMemoizeAsync(
	RUNS_TTL_MS,
	(input: {
		token: string
		fullName: string
		workflowId: number
		limit: number
	}) =>
		`${input.fullName}#${String(input.workflowId)}#${String(input.limit)}`,
	fetchDeployRuns,
)

export const listDeployRuns = (
	token: string,
	fullName: string,
	workflowId: number,
	limit: number,
): Promise<ReadonlyArray<RawDeployRun>> =>
	memoizedDeployRuns({ token, fullName, workflowId, limit })
