export interface HcloudCreatedState {
	readonly phase: 'created'
	readonly serverId: number
	readonly publicIp: string
}

export interface HcloudProvisionedState {
	readonly phase: 'provisioned'
	readonly serverId: number
	readonly publicIp: string
	readonly tailnetIp: string
	readonly sshHostKeyFingerprint?: string | undefined
}

export interface HcloudConvergedState {
	readonly phase: 'converged'
	readonly serverId: number
	readonly publicIp: string
	readonly tailnetIp: string
	readonly convergedAt: string
	readonly sshHostKeyFingerprint?: string | undefined
}

export type HcloudProjectState =
	| HcloudCreatedState
	| HcloudProvisionedState
	| HcloudConvergedState
