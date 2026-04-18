/**
 * Single source of truth for all infrastructure resources managed by
 * the Hetzner VPS target. Both provision and teardown derive their
 * exhaustiveness checks from this tuple - adding a resource here
 * breaks both flows at compile-time until handled.
 */
export const VPS_MANAGED_RESOURCES = [
	'server',
	'firewall',
	'tailscale',
	'dns',
	'state',
] as const

export type VpsManagedResource = (typeof VPS_MANAGED_RESOURCES)[number]
