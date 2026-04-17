export interface FirewallRule {
	readonly description: string
	readonly direction: 'in' | 'out'
	readonly protocol: 'tcp' | 'udp' | 'icmp'
	readonly port: string
	readonly source_ips: ReadonlyArray<string>
}

const ALL_SOURCES: ReadonlyArray<string> = ['0.0.0.0/0', '::/0']

const SSH_RULE: FirewallRule = {
	description: 'SSH',
	direction: 'in',
	protocol: 'tcp',
	port: '22',
	source_ips: ALL_SOURCES,
}

const HTTP_RULE: FirewallRule = {
	description: 'HTTP',
	direction: 'in',
	protocol: 'tcp',
	port: '80',
	source_ips: ALL_SOURCES,
}

const HTTPS_RULE: FirewallRule = {
	description: 'HTTPS',
	direction: 'in',
	protocol: 'tcp',
	port: '443',
	source_ips: ALL_SOURCES,
}

/**
 * Compute the Hetzner cloud firewall rules for a VPS.
 *
 * - Public: HTTP + HTTPS + SSH (UFW restricts SSH to tailscale0)
 * - Internal: SSH only (UFW restricts everything to tailscale0)
 */
export function computeFirewallRules(
	internal: boolean,
): ReadonlyArray<FirewallRule> {
	if (internal) return [SSH_RULE]
	return [HTTP_RULE, HTTPS_RULE, SSH_RULE]
}
