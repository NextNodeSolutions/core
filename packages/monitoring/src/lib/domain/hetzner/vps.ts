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

export const VPS_CPU_TYPES = ['shared', 'dedicated', 'unknown'] as const
export type VpsCpuType = (typeof VPS_CPU_TYPES)[number]

export const VPS_ARCHITECTURES = ['x86', 'arm', 'unknown'] as const
export type VpsArchitecture = (typeof VPS_ARCHITECTURES)[number]

export interface HetznerVpsLocation {
	readonly name: string
	readonly city: string | null
	readonly country: string | null
	readonly datacenter: string | null
}

export interface HetznerVpsServerType {
	readonly name: string
	readonly description: string
	readonly cores: number
	readonly memoryGb: number
	readonly diskGb: number
	readonly cpuType: VpsCpuType
	readonly architecture: VpsArchitecture
}

export interface HetznerVpsTraffic {
	readonly ingoingBytes: number
	readonly outgoingBytes: number
	readonly includedBytes: number
}

export interface HetznerVpsProtection {
	readonly delete: boolean
	readonly rebuild: boolean
}

export interface HetznerVps {
	readonly id: number
	readonly name: string
	readonly status: VpsStatus
	readonly ipv4: string | null
	readonly ipv6: string | null
	readonly serverType: HetznerVpsServerType
	readonly location: HetznerVpsLocation
	readonly image: string | null
	readonly createdAt: string
	readonly labels: Readonly<Record<string, string>>
	readonly traffic: HetznerVpsTraffic
	readonly protection: HetznerVpsProtection
	readonly backupsEnabled: boolean
	readonly locked: boolean
	readonly volumeCount: number
}

export const parseVpsStatus = (value: unknown): VpsStatus =>
	parseStringUnion(value, VPS_STATUSES, 'unknown')

export const parseVpsCpuType = (value: unknown): VpsCpuType =>
	parseStringUnion(value, VPS_CPU_TYPES, 'unknown')

export const parseVpsArchitecture = (value: unknown): VpsArchitecture =>
	parseStringUnion(value, VPS_ARCHITECTURES, 'unknown')
