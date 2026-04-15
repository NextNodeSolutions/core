import { createHash } from 'node:crypto'

export interface CloudflareTokenResult {
	readonly id: string
	readonly value: string
}

export interface R2StaticCredentials {
	readonly accessKeyId: string
	readonly secretAccessKey: string
}

/**
 * Derive S3-compatible R2 credentials from a Cloudflare API token response.
 * R2 uses the token id as the AWS access key id, and SHA-256(token value)
 * hex-encoded as the secret access key.
 */
export function deriveR2Credentials(
	token: CloudflareTokenResult,
): R2StaticCredentials {
	return {
		accessKeyId: token.id,
		secretAccessKey: createHash('sha256').update(token.value).digest('hex'),
	}
}
