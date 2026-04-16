export interface FirewallRule {
	readonly description: string
	readonly direction: 'in' | 'out'
	readonly protocol: 'tcp' | 'udp' | 'icmp'
	readonly port: string
	readonly source_ips: ReadonlyArray<string>
}

export const DEFAULT_FIREWALL_RULES: ReadonlyArray<FirewallRule> = [
	{
		description: 'HTTP',
		direction: 'in',
		protocol: 'tcp',
		port: '80',
		source_ips: ['0.0.0.0/0', '::/0'],
	},
	{
		description: 'HTTPS',
		direction: 'in',
		protocol: 'tcp',
		port: '443',
		source_ips: ['0.0.0.0/0', '::/0'],
	},
	{
		description: 'SSH',
		direction: 'in',
		protocol: 'tcp',
		port: '22',
		source_ips: ['0.0.0.0/0', '::/0'],
	},
]
