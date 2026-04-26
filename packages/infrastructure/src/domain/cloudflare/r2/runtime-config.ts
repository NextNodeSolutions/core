/**
 * Runtime-resolved config for the **infra storage** — the bootstrap
 * S3-compatible buckets owned by the platform itself, distinct from the
 * user-data buckets declared by a project under `[services.*]`.
 *  - `stateBucket` — Hetzner provisioning state + per-project service state
 *  - `certsBucket` — Caddy ACME cert storage on the VPS
 *
 * Threaded explicitly from `ensureR2Setup` (provision-time) or
 * `loadR2Runtime` (deploy-time) into adapters that need it — passing it
 * explicitly avoids hidden coupling via `process.env` mutation.
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
