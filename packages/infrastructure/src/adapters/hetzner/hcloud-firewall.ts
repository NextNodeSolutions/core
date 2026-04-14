export interface FirewallRule {
	readonly description: string
	readonly direction: 'in' | 'out'
	readonly protocol: 'tcp' | 'udp' | 'icmp'
	readonly port: string
	readonly source_ips: ReadonlyArray<string>
}

export interface HcloudFirewallResponse {
	readonly id: number
	readonly name: string
}
