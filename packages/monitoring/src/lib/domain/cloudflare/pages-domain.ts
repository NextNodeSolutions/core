import type { BadgeStatus } from '@/lib/domain/badge-status.ts'
import { parseStringUnion } from '@/lib/domain/parse-string-union.ts'

export const CLOUDFLARE_PAGES_DOMAIN_STATUSES = [
	'active',
	'pending',
	'canceled',
	'error',
	'unknown',
] as const

export type CloudflarePagesDomainStatus =
	(typeof CLOUDFLARE_PAGES_DOMAIN_STATUSES)[number]

export interface CloudflarePagesDomain {
	readonly name: string
	readonly status: CloudflarePagesDomainStatus
	readonly verificationData: string | null
	readonly certificateAuthority: string | null
	readonly createdAt: string
}

export const DOMAIN_BADGE_STATUS: Record<
	CloudflarePagesDomainStatus,
	BadgeStatus
> = {
	active: 'healthy',
	pending: 'degraded',
	canceled: 'unknown',
	error: 'down',
	unknown: 'unknown',
}

export const parseCloudflarePagesDomainStatus = (
	value: unknown,
): CloudflarePagesDomainStatus =>
	parseStringUnion(value, CLOUDFLARE_PAGES_DOMAIN_STATUSES, 'unknown')
