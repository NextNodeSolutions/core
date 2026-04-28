export interface HcloudCreatedState {
	readonly phase: 'created'
	readonly serverId: number
	readonly publicIp: string
	readonly hostPorts: Readonly<Record<string, number>>
}

export interface HcloudProvisionedState {
	readonly phase: 'provisioned'
	readonly serverId: number
	readonly publicIp: string
	readonly tailnetIp: string
	readonly sshHostKeyFingerprint?: string | undefined
	readonly hostPorts: Readonly<Record<string, number>>
}

export interface HcloudConvergedState {
	readonly phase: 'converged'
	readonly serverId: number
	readonly publicIp: string
	readonly tailnetIp: string
	readonly convergedAt: string
	readonly sshHostKeyFingerprint?: string | undefined
	readonly hostPorts: Readonly<Record<string, number>>
}

export type HcloudVpsState =
	| HcloudCreatedState
	| HcloudProvisionedState
	| HcloudConvergedState
