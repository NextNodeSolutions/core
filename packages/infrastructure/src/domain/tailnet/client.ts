/**
 * Provider-agnostic tailnet contract. Adapters that need to mint
 * ephemeral auth keys, resolve a host's tailnet IP, or evict stale
 * devices consume this through the cli-layer factory instead of
 * reaching across to the Tailscale adapter directly - cross-adapter
 * calls are forbidden by the layered architecture.
 *
 * Tailscale is the only tailnet provider today; adding another (e.g.
 * Headscale, Nebula) means a second implementation of this contract
 * plus a switch in the cli factory.
 */
export interface MintedAuthkey {
	readonly key: string
	readonly expires: string
}

export interface TailnetClient {
	mintAuthkey(
		tags: ReadonlyArray<string>,
		ttlSeconds: number,
		description: string,
	): Promise<MintedAuthkey>
	getIpByHostname(hostname: string): Promise<string>
	deleteByHostname(hostname: string): Promise<number>
	/**
	 * Read the tailnet ACL policy as a parsed JSON object. Throws
	 * `TailnetAclScopeError` when the OAuth client lacks the `acl` scope so the
	 * caller can degrade gracefully (the policy is operator-owned).
	 */
	getAclPolicy(): Promise<Record<string, unknown>>
	/** Replace the tailnet ACL policy. Same scope contract as `getAclPolicy`. */
	setAclPolicy(policy: Record<string, unknown>): Promise<void>
}

/**
 * Raised when an ACL read/write is rejected for lack of the `acl` OAuth scope
 * (HTTP 403). Distinct from generic failures so callers treat a missing scope
 * as "skip, operator grants it once" rather than a hard error.
 */
export class TailnetAclScopeError extends Error {}
