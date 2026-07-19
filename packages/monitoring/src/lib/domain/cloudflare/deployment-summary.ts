import { findCanonicalProductionDeployment } from '@/lib/domain/cloudflare/pages-deployment.ts'

import type {
	CloudflarePagesDeployment,
	CloudflarePagesDeploymentStatus,
} from '@/lib/domain/cloudflare/pages-deployment.ts'

/**
 * Display + summary logic for the deployments screen. Pure: callers pass the
 * real Cloudflare Pages deployments (newest-first, as the API returns them).
 */

const PERCENT_SCALE = 100
const LAST_STATUS_COUNT = 5

export type DeployDisplayStatus = 'ready' | 'building' | 'error' | 'idle'

const DISPLAY_BY_STATUS: Record<
	CloudflarePagesDeploymentStatus,
	DeployDisplayStatus
> = {
	success: 'ready',
	active: 'building',
	failure: 'error',
	canceled: 'idle',
	skipped: 'idle',
	idle: 'idle',
	unknown: 'idle',
}

export const deploymentDisplayStatus = (
	status: CloudflarePagesDeploymentStatus,
): DeployDisplayStatus => DISPLAY_BY_STATUS[status]

const COMMIT_LENGTH = 7

/** The short commit hash a deployment displays, or its shortId without one. */
export const deploymentCommitLabel = (
	deployment: Pick<CloudflarePagesDeployment, 'commitHash' | 'shortId'>,
): string =>
	deployment.commitHash?.slice(0, COMMIT_LENGTH) ?? deployment.shortId

export interface ProjectSummary {
	readonly current: CloudflarePagesDeployment | null
	readonly last: CloudflarePagesDeployment | null
	readonly prodCount: number
	readonly previewCount: number
	// null = no deployment has finished yet, so a rate would be meaningless
	// (a 100% on zero samples reads as "all good" and misleads).
	readonly successRate: number | null
	readonly lastStatuses: ReadonlyArray<DeployDisplayStatus>
}

export const summarizeProject = (
	deployments: ReadonlyArray<CloudflarePagesDeployment>,
): ProjectSummary => {
	const prodCount = deployments.filter(
		deployment => deployment.environment === 'production',
	).length
	const finished = deployments.filter(
		deployment =>
			deployment.status === 'success' || deployment.status === 'failure',
	)
	const succeeded = finished.filter(
		deployment => deployment.status === 'success',
	).length
	const successRate =
		finished.length === 0
			? null
			: Math.round((succeeded / finished.length) * PERCENT_SCALE)
	return {
		current:
			findCanonicalProductionDeployment(deployments) ??
			deployments[0] ??
			null,
		last: deployments[0] ?? null,
		prodCount,
		previewCount: deployments.length - prodCount,
		successRate,
		lastStatuses: deployments
			.slice(0, LAST_STATUS_COUNT)
			.map(deployment => deploymentDisplayStatus(deployment.status)),
	}
}

export type StepState = 'done' | 'active' | 'pending' | 'failed'

export interface PipelineStep {
	readonly label: string
	readonly state: StepState
}

export const deploymentPipelineSteps = (
	status: CloudflarePagesDeploymentStatus,
): ReadonlyArray<PipelineStep> => {
	const display = deploymentDisplayStatus(status)
	const building = display === 'building'
	const ready = display === 'ready'
	const errored = display === 'error'
	const finalState: StepState = ready
		? 'done'
		: errored
			? 'failed'
			: 'pending'
	const steps: PipelineStep[] = [
		{ label: 'Queued', state: 'done' },
		{ label: 'Cloning', state: 'done' },
		{ label: 'Building', state: building ? 'active' : 'done' },
		{ label: 'Deploying', state: ready ? 'done' : 'pending' },
		{ label: errored ? 'Failed' : 'Ready', state: finalState },
	]
	return steps
}

export interface RecentDeployment {
	readonly projectName: string
	readonly deployment: CloudflarePagesDeployment
}

export const selectRecentDeployments = (
	entries: ReadonlyArray<RecentDeployment>,
	limit: number,
): ReadonlyArray<RecentDeployment> =>
	entries
		.toSorted((left, right) =>
			right.deployment.createdAt.localeCompare(left.deployment.createdAt),
		)
		.slice(0, limit)
