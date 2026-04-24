import type { BadgeStatus } from '@/lib/domain/badge-status.ts'
import type { CloudflarePagesDeployment } from '@/lib/domain/cloudflare/pages-deployment.ts'

export interface ProjectHealth {
	readonly status: BadgeStatus
	readonly label: string
}

// Cloudflare always serves the latest successful production deployment, so a
// project can be live even when the most recent build failed. Deployments are
// assumed newest-first (Cloudflare's default order).
export const computeProjectHealth = (
	deployments: ReadonlyArray<CloudflarePagesDeployment>,
): ProjectHealth => {
	let latest: CloudflarePagesDeployment | null = null
	let hasCanonical = false
	for (const deployment of deployments) {
		if (deployment.environment !== 'production') continue
		latest ??= deployment
		if (deployment.status === 'success') {
			hasCanonical = true
			break
		}
	}

	if (!latest) return { status: 'unknown', label: 'Not deployed' }
	if (latest.status === 'active') {
		return { status: 'degraded', label: 'Deploying' }
	}
	if (!hasCanonical) return { status: 'down', label: 'Never built' }
	if (latest.status === 'failure') {
		return { status: 'degraded', label: 'Last build failed' }
	}
	return { status: 'healthy', label: 'Live' }
}
