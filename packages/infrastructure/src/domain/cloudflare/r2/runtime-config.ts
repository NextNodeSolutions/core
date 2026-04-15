/**
 * Runtime-resolved R2 configuration threaded from `ensureR2Setup`
 * to any adapter that needs R2 (HetznerVpsTarget, etc). Passing it
 * explicitly avoids hidden coupling via `process.env` mutation.
 */
export interface R2RuntimeConfig {
	readonly accountId: string
	readonly endpoint: string
	readonly accessKeyId: string
	readonly secretAccessKey: string
	readonly stateBucket: string
	readonly certsBucket: string
}
