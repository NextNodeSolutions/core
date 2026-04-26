/**
 * Provider-agnostic object-store contract for ETag-locked state and
 * certificate persistence (Cloudflare R2 today; AWS S3, MinIO, Backblaze
 * B2 fit the same shape). Adapters that need to read or write durable
 * state consume this through the cli-layer factory instead of reaching
 * across to the R2 adapter directly — cross-adapter calls are forbidden
 * by the layered architecture.
 *
 * `put` returns the post-write ETag so callers can keep optimistic
 * concurrency without re-reading the object. `ifMatch` enforces compare-
 * and-swap semantics; the adapter throws when the condition fails.
 */
export interface ObjectStoreEntry {
	readonly body: string
	readonly etag: string
}

export interface ObjectStoreClient {
	get(key: string): Promise<ObjectStoreEntry | null>
	put(key: string, body: string, ifMatch?: string): Promise<string>
	delete(key: string): Promise<void>
	exists(key: string): Promise<boolean>
	deleteByPrefix(prefix: string): Promise<number>
}
