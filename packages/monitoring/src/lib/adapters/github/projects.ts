import { ENV_KEYS, requireEnv } from '@/lib/adapters/env.ts'
import { listOrgRepos } from '@/lib/adapters/github/repos.ts'
import { getLatestWorkflowRun } from '@/lib/adapters/github/workflow-runs.ts'
import { mapWithConcurrency } from '@/lib/domain/concurrency.ts'
import { summarizeGithubProject } from '@/lib/domain/github/github-project.ts'

import type { GithubProjectSummary } from '@/lib/domain/github/github-project.ts'

// Cap the per-repo run-query fan-out so a large org does not burst N parallel
// GitHub calls at once (and hit the rate limit).
const MAX_CONCURRENCY = 6

/**
 * The org's GitHub projects, each enriched with its latest workflow run and
 * mapped to a hosting VPS by name. `serverNames` comes from the metrics-discovered fleet
 * (empty when unavailable, which simply leaves every `vps` null). One run
 * query per repo, in parallel.
 */
export const loadGithubProjects = async (
	serverNames: ReadonlyArray<string>,
): Promise<ReadonlyArray<GithubProjectSummary>> => {
	const token = requireEnv(ENV_KEYS.GITHUB_TOKEN)
	const repos = await listOrgRepos(token)
	return mapWithConcurrency(repos, MAX_CONCURRENCY, async repo => {
		const run = await getLatestWorkflowRun(token, repo.fullName)
		return summarizeGithubProject(repo, run, serverNames)
	})
}
