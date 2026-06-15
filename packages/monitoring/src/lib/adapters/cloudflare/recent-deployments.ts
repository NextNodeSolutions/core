import { resolveCloudflareClient } from '@/lib/adapters/cloudflare/accounts.ts'
import { listPagesDeployments } from '@/lib/adapters/cloudflare/pages-deployments.ts'
import { listPagesProjects } from '@/lib/adapters/cloudflare/pages-projects.ts'
import { mapWithConcurrency } from '@/lib/adapters/concurrency.ts'
import { selectRecentDeployments } from '@/lib/domain/cloudflare/deployment-summary.ts'

import type { RecentDeployment } from '@/lib/domain/cloudflare/deployment-summary.ts'

// Each project's latest few deployments are enough to assemble a fleet-wide
// "recent activity" view without paginating any single project's history.
const PER_PROJECT_LIMIT = 5
// Cap the per-project fan-out so a large fleet does not open one Cloudflare
// socket per project at once (and trip the API rate limit).
const MAX_CONCURRENCY = 6

/**
 * Recent deployments across every Cloudflare Pages project, newest-first,
 * capped to `limit`. Fans out one deployments query per project (bounded) and
 * merges via the pure selector. Each project's query is independent.
 */
export const loadRecentDeployments = async (
	limit: number,
): Promise<ReadonlyArray<RecentDeployment>> => {
	const client = await resolveCloudflareClient()
	const projects = await listPagesProjects({ client })
	const perProject = await mapWithConcurrency(
		projects,
		MAX_CONCURRENCY,
		async project => {
			const deployments = await listPagesDeployments({
				client,
				projectName: project.name,
				limit: PER_PROJECT_LIMIT,
			})
			return deployments.map(deployment => ({
				projectName: project.name,
				deployment,
			}))
		},
	)
	return selectRecentDeployments(perProject.flat(), limit)
}
