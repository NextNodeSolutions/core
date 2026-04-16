/**
 * Bundled context passed through R2 orchestration helpers. Keeps the
 * Cloudflare API token, the resolved account id, and the canonical bucket
 * names in one object so provisioning steps don't thread 4 positional
 * args through every level.
 */
export interface R2Context {
	readonly cfToken: string
	readonly accountId: string
	readonly stateBucket: string
	readonly certsBucket: string
}
