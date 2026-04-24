import type { BadgeStatus } from '@/lib/domain/badge-status.ts'
import { parseStringUnion } from '@/lib/domain/parse-string-union.ts'

export const SHORT_ID_LENGTH = 8
export const GIT_SHORT_HASH_LENGTH = 7

export const CLOUDFLARE_PAGES_DEPLOYMENT_STATUSES = [
	'success',
	'failure',
	'canceled',
	'skipped',
	'active',
	'idle',
	'unknown',
] as const

export type CloudflarePagesDeploymentStatus =
	(typeof CLOUDFLARE_PAGES_DEPLOYMENT_STATUSES)[number]

export const CLOUDFLARE_PAGES_DEPLOYMENT_ENVIRONMENTS = [
	'production',
	'preview',
] as const

export type CloudflarePagesDeploymentEnvironment =
	(typeof CLOUDFLARE_PAGES_DEPLOYMENT_ENVIRONMENTS)[number]

export const parseCloudflarePagesDeploymentEnvironment = (
	value: unknown,
): CloudflarePagesDeploymentEnvironment =>
	parseStringUnion(value, CLOUDFLARE_PAGES_DEPLOYMENT_ENVIRONMENTS, 'preview')

export interface CloudflarePagesDeployment {
	readonly id: string
	readonly shortId: string
	readonly environment: CloudflarePagesDeploymentEnvironment
	readonly url: string | null
	readonly branch: string | null
	readonly commitHash: string | null
	readonly commitMessage: string | null
	readonly author: string | null
	readonly trigger: string | null
	readonly createdAt: string
	readonly modifiedAt: string
	readonly status: CloudflarePagesDeploymentStatus
	readonly stageName: string | null
	readonly isSkipped: boolean
	readonly aliases: ReadonlyArray<string>
}

export const DEPLOYMENT_BADGE_STATUS: Record<
	CloudflarePagesDeploymentStatus,
	BadgeStatus
> = {
	success: 'healthy',
	active: 'degraded',
	idle: 'unknown',
	skipped: 'unknown',
	canceled: 'unknown',
	failure: 'down',
	unknown: 'unknown',
}

export const parseCloudflarePagesDeploymentStatus = (
	value: unknown,
): CloudflarePagesDeploymentStatus =>
	parseStringUnion(value, CLOUDFLARE_PAGES_DEPLOYMENT_STATUSES, 'unknown')

const isSuccessfulProductionDeployment = (
	deployment: CloudflarePagesDeployment,
): boolean =>
	deployment.environment === 'production' && deployment.status === 'success'

// Cloudflare returns deployments newest-first; both helpers rely on that order.

export const findCanonicalProductionDeployment = (
	deployments: ReadonlyArray<CloudflarePagesDeployment>,
): CloudflarePagesDeployment | null =>
	deployments.find(isSuccessfulProductionDeployment) ?? null

export const findRollbackCandidate = (
	deployments: ReadonlyArray<CloudflarePagesDeployment>,
): CloudflarePagesDeployment | null => {
	const canonical = findCanonicalProductionDeployment(deployments)
	if (!canonical) return null
	return (
		deployments.find(
			deployment =>
				isSuccessfulProductionDeployment(deployment) &&
				deployment.id !== canonical.id,
		) ?? null
	)
}
