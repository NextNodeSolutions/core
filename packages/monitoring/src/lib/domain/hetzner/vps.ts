import { parseStringUnion } from '@/lib/domain/parse-string-union.ts'

export const VPS_STATUSES = [
	'initializing',
	'starting',
	'running',
	'stopping',
	'off',
	'deleting',
	'migrating',
	'rebuilding',
	'unknown',
] as const

export type VpsStatus = (typeof VPS_STATUSES)[number]

export interface HetznerVps {
	readonly id: number
	readonly name: string
	readonly status: VpsStatus
	readonly ipv4: string | null
	readonly serverType: string
	readonly location: string
	readonly createdAt: string
	readonly labels: Readonly<Record<string, string>>
}

export const parseVpsStatus = (value: unknown): VpsStatus =>
	parseStringUnion(value, VPS_STATUSES, 'unknown')
