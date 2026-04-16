/**
 * Runtime-resolved R2 configuration threaded from either `ensureR2Setup`
 * (provision-time bootstrap) or `loadR2Runtime` (deploy-time load) to any
 * adapter that needs R2 (HetznerVpsTarget, etc). Passing it explicitly
 * avoids hidden coupling via `process.env` mutation.
 */
export interface R2RuntimeConfig {
	readonly accountId: string
	readonly endpoint: string
	readonly accessKeyId: string
	readonly secretAccessKey: string
	readonly stateBucket: string
	readonly certsBucket: string
}
