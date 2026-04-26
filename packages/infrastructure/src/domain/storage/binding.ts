/**
 * Provider-agnostic binding for an S3-API-compatible object store
 * (Cloudflare R2 today; AWS S3, MinIO, Backblaze B2 fit the same shape).
 * Consumers like Caddy's TLS storage live entirely against this contract
 * and never reach into a specific provider's runtime config — so a new
 * storage backend means a new builder, not a domain-wide refactor.
 *
 * `prefix` is the per-project key namespace under `bucket` (e.g.
 * `"acme-web/"`); the secret access key is never stored here — it
 * routes via env placeholders so the JSON config stays world-readable.
 */
export interface ObjectStorageBinding {
	readonly host: string
	readonly bucket: string
	readonly accessKeyId: string
	readonly prefix: string
}
