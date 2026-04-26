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
	value: unknown,
): CloudflareZoneStatus =>
	parseStringUnion(value, CLOUDFLARE_ZONE_STATUSES, 'unknown')
