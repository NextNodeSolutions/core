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
}

export interface HcloudConvergedState {
	readonly phase: 'converged'
	readonly serverId: number
	readonly publicIp: string
	readonly tailnetIp: string
	readonly convergedAt: string
}

export type HcloudProjectState =
	| HcloudCreatedState
	| HcloudProvisionedState
	| HcloudConvergedState
