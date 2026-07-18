import type { DeployDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'
import type { CloudflarePagesDeploymentEnvironment } from '@/lib/domain/cloudflare/pages-deployment.ts'

/**
 * A GitHub Actions run of a VPS deploy workflow (a caller of the reusable
 * deploy.yml), shaped for the deployments activity feed. Field values come
 * verbatim from the runs API; only `environment` is derived (see below).
 */

const SHORT_SHA_LENGTH = 7

export interface VpsDeployRun {
	readonly id: string
	readonly repoName: string
	readonly workflowName: string
	readonly title: string
	readonly branch: string | null
	readonly headSha: string
	readonly htmlUrl: string
	readonly createdAt: string
	readonly status: string
	readonly conclusion: string | null
	readonly environment: CloudflarePagesDeploymentEnvironment
}

const FAILED_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out'])
const PENDING_STATUSES = new Set([
	'queued',
	'waiting',
	'pending',
	'requested',
	'in_progress',
])

/** Map a run's status/conclusion pair onto the shared deploy display states. */
export const vpsRunDisplayStatus = (run: {
	readonly status: string
	readonly conclusion: string | null
}): DeployDisplayStatus => {
	if (PENDING_STATUSES.has(run.status)) return 'building'
	if (run.status !== 'completed') return 'idle'
	if (run.conclusion === 'success') return 'ready'
	if (run.conclusion !== null && FAILED_CONCLUSIONS.has(run.conclusion)) {
		return 'error'
	}
	return 'idle'
}

/**
 * Business rule: a deploy run on the repo's default branch is the production
 * deploy; a run on any other branch (or with no branch, e.g. a deleted head)
 * is a preview/dev deploy. The runs API does not expose the reusable
 * workflow's `environment` input, so the branch is the only honest signal.
 */
export const vpsRunEnvironment = (
	branch: string | null,
	defaultBranch: string,
): CloudflarePagesDeploymentEnvironment =>
	branch !== null && branch === defaultBranch ? 'production' : 'preview'

export const vpsRunShortSha = (run: VpsDeployRun): string =>
	run.headSha.slice(0, SHORT_SHA_LENGTH)
