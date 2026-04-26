/**
 * Runtime-resolved config for the **infra storage** — the bootstrap S3-compatible
 * buckets owned by the platform itself, not the user-data buckets declared by a
 * project under `[services.*]`. Two buckets:
 *  - `stateBucket` — Hetzner provisioning state + storage service state per project
 *  - `certsBucket` — Caddy ACME cert storage on the VPS
 *
 * Threaded explicitly from either `ensureR2Setup` (provision-time
 * bootstrap) or `loadR2Runtime` (deploy-time load) into any adapter that
 * needs it (HetznerVpsTarget, the R2 service ensure/load, etc). Passing
 * it explicitly avoids hidden coupling via `process.env` mutation.
 *
 * Named `InfraStorage` (not `InfraR2`) so consumer code stays
 * provider-agnostic if we ever swap R2 for another S3-compatible backend.
 */
export interface InfraStorageRuntimeConfig {
	readonly accountId: string
	readonly endpoint: string
	readonly accessKeyId: string
	readonly secretAccessKey: string
	readonly stateBucket: string
	readonly certsBucket: string
}
