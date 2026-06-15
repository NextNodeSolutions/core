import type { IconName } from '@/components/foundations/Icon.astro'
import type { DeployDisplayStatus } from '@/lib/domain/cloudflare/deployment-summary.ts'

/**
 * Icon + Tailwind text colour for each deploy display status, shared by the
 * overview and deployments screens so the mapping lives in exactly one place.
 */
export const DEPLOY_STATUS_ICON: Record<DeployDisplayStatus, IconName> = {
	ready: 'check',
	building: 'refresh',
	error: 'x',
	idle: 'dot',
}

export const DEPLOY_STATUS_COLOR: Record<DeployDisplayStatus, string> = {
	ready: 'text-emerald-600',
	building: 'text-sky-600',
	error: 'text-red-600',
	idle: 'text-base-400',
}
