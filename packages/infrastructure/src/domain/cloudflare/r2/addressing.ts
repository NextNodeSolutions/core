/**
 * Single source of truth for every R2 identifier / URL format.
 *
 *   - `computeR2Endpoint` / `computeR2Host` — S3 data-plane addressing,
 *     consumed by the AWS SDK and the SigV4 handshake.
 *   - `bucketResourceKey` — Cloudflare IAM resource identifier, consumed
 *     when building the `POST /user/tokens` policy body.
 *
 * Keep all R2 addressing here so format changes happen in one place.
 */

export function computeR2Endpoint(accountId: string): string {
	return `https://${accountId}.r2.cloudflarestorage.com`
}

export function computeR2Host(accountId: string): string {
	return `${accountId}.r2.cloudflarestorage.com`
}

export function bucketResourceKey(
	accountId: string,
	bucketName: string,
): string {
	return `com.cloudflare.edge.r2.bucket.${accountId}_default_${bucketName}`
}
