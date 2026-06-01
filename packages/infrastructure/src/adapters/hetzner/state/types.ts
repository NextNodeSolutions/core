// Host ports allocated on this VPS, keyed by project then by service instance
// name: `hostPorts[project][service] = port`. Only `url` services hold a port
// (internal-only services expose none), and ports are unique across all
// projects sharing the VPS.
type HostPortMap = Readonly<Record<string, Readonly<Record<string, number>>>>

export interface HcloudCreatedState {
	readonly phase: 'created'
	readonly serverId: number
	readonly publicIp: string
	readonly hostPorts: HostPortMap
}

export interface HcloudProvisionedState {
	readonly phase: 'provisioned'
	readonly serverId: number
	readonly publicIp: string
	readonly tailnetIp: string
	readonly sshHostKeyFingerprint?: string | undefined
	readonly hostPorts: HostPortMap
}

export interface HcloudConvergedState {
	readonly phase: 'converged'
	readonly serverId: number
	readonly publicIp: string
	readonly tailnetIp: string
	readonly convergedAt: string
	readonly sshHostKeyFingerprint?: string | undefined
	readonly hostPorts: HostPortMap
}

export type HcloudVpsState =
	| HcloudCreatedState
	| HcloudProvisionedState
	| HcloudConvergedState
