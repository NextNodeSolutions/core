export type VpsStatus =
	| 'initializing'
	| 'starting'
	| 'running'
	| 'stopping'
	| 'off'
	| 'deleting'
	| 'migrating'
	| 'rebuilding'
	| 'unknown'

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

const VPS_STATUS_VALUES: ReadonlyArray<VpsStatus> = [
	'initializing',
	'starting',
	'running',
	'stopping',
	'off',
	'deleting',
	'migrating',
	'rebuilding',
	'unknown',
]

export const parseVpsStatus = (raw: string): VpsStatus =>
	VPS_STATUS_VALUES.find(status => status === raw) ?? 'unknown'
