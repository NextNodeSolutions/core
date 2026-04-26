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
	'certs',
	'dns',
	'state',
] as const

export type VpsManagedResource = (typeof VPS_MANAGED_RESOURCES)[number]

/**
 * Resources scoped to a single project stack on a (potentially shared) VPS.
 * Teardown in this scope removes only the project's footprint (compose stack,
 * bind mount, Caddy route, certs prefix, DNS, state) and leaves the VPS,
 * firewall, Tailscale device, and host-level services intact.
 */
export const VPS_PROJECT_MANAGED_RESOURCES = [
	'container',
	'caddy',
	'certs',
	'dns',
	'state',
] as const

export type VpsProjectManagedResource =
	(typeof VPS_PROJECT_MANAGED_RESOURCES)[number]
