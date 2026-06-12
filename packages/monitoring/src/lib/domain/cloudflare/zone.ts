import { parseStringUnion } from '@/lib/domain/parse-string-union.ts'

export const CLOUDFLARE_ZONE_STATUSES = [
	'active',
	'pending',
	'initializing',
	'moved',
	'deleted',
	'deactivated',
	'read only',
	'unknown',
] as const

export type CloudflareZoneStatus = (typeof CLOUDFLARE_ZONE_STATUSES)[number]

export interface CloudflareZone {
	readonly id: string
	readonly name: string
	readonly status: CloudflareZoneStatus
}

export const parseCloudflareZoneStatus = (
	candidate: unknown,
): CloudflareZoneStatus =>
	parseStringUnion(candidate, CLOUDFLARE_ZONE_STATUSES, 'unknown')
