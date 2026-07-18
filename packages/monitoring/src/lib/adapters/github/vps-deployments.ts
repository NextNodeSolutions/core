import { resolveGithubToken } from '@/lib/adapters/github/app-token.ts'
import { listDeployRuns } from '@/lib/adapters/github/deploy-runs.ts'
import { listDeployWorkflows } from '@/lib/adapters/github/deploy-workflows.ts'
import { listOrgRepos } from '@/lib/adapters/github/repos.ts'
import { mapWithConcurrency } from '@/lib/domain/concurrency.ts'
import { vpsRunEnvironment } from '@/lib/domain/github/vps-deploy-run.ts'

import type { GithubRepo } from '@/lib/domain/github/github-project.ts'
import type { VpsDeployRun } from '@/lib/domain/github/vps-deploy-run.ts'

/**
 * VPS deployments across the org: for every non-archived repo, the latest
 * runs of each workflow that calls the reusable deploy.yml, joined with the
 * repo record into the domain VpsDeployRun shape. One deploy-workflows lookup
 * per repo (long-cached) + one runs query per deploy workflow.
 */

// Cap the per-repo fan-out so a large org does not burst N parallel GitHub
// calls at once (and hit the rate limit). Mirrors github/projects.ts.
const REPO_CONCURRENCY = 6
// A repo rarely has more than one deploy workflow; keep the inner fan-out tiny.
const WORKFLOW_CONCURRENCY = 2

const loadRepoDeployRuns = async (
	token: string,
	repo: GithubRepo,
	perWorkflowLimit: number,
): Promise<ReadonlyArray<VpsDeployRun>> => {
	const workflows = await listDeployWorkflows(token, repo.fullName)
	const runsPerWorkflow = await mapWithConcurrency(
		workflows,
		WORKFLOW_CONCURRENCY,
		workflow =>
			listDeployRuns(token, repo.fullName, workflow.id, perWorkflowLimit),
	)
	return runsPerWorkflow.flat().map(run => ({
		id: run.id,
		repoName: repo.name,
		workflowName: run.workflowName,
		title: run.displayTitle,
		branch: run.headBranch,
		headSha: run.headSha,
		htmlUrl: run.htmlUrl,
		createdAt: run.createdAt,
		status: run.status,
		conclusion: run.conclusion,
		environment: vpsRunEnvironment(run.headBranch, repo.defaultBranch),
	}))
}

/** Every VPS deploy run across the org, unordered (the domain selector sorts). */
export const loadVpsDeployRuns = async (
	perWorkflowLimit: number,
): Promise<ReadonlyArray<VpsDeployRun>> => {
	const token = await resolveGithubToken()
	const repos = (await listOrgRepos(token)).filter(repo => !repo.archived)
	const perRepo = await mapWithConcurrency(repos, REPO_CONCURRENCY, repo =>
		loadRepoDeployRuns(token, repo, perWorkflowLimit),
	)
	return perRepo.flat()
}
