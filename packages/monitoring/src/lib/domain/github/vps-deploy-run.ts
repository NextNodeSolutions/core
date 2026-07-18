import { runPhase, shortSha } from '@/lib/domain/github/run-status.ts'

import type { DeployDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'
import type { CloudflarePagesDeploymentEnvironment } from '@/lib/domain/cloudflare/pages-deployment.ts'
import type { RunPhase } from '@/lib/domain/github/run-status.ts'

/**
 * A GitHub Actions run of a VPS deploy workflow (a caller of the reusable
 * deploy.yml), shaped for the deployments activity feed. Field values come
 * verbatim from the runs API; only `environment` is derived (see below).
 */

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

/** The feed collapses every not-yet-finished phase into "building". */
const RUN_PHASE_DISPLAY = {
	queued: 'building',
	pending: 'building',
	running: 'building',
	succeeded: 'ready',
	failed: 'error',
	unknown: 'idle',
} satisfies Record<RunPhase, DeployDisplayStatus>

/** Map a run's status/conclusion pair onto the shared deploy display states. */
export const vpsRunDisplayStatus = (run: {
	readonly status: string
	readonly conclusion: string | null
}): DeployDisplayStatus => RUN_PHASE_DISPLAY[runPhase(run)]

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
	shortSha(run.headSha)
