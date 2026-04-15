import { signSigV4Request } from '../../domain/aws/sigv4.ts'
import { computeR2Host } from '../../domain/cloudflare/r2/addressing.ts'

const UNAUTHORIZED = 401
const FORBIDDEN = 403

export interface VerifyR2CredentialsInput {
	readonly accountId: string
	readonly accessKeyId: string
	readonly secretAccessKey: string
	readonly bucketName: string
}

export type VerifyR2Result =
	| { readonly valid: true }
	| { readonly valid: false; readonly status: number; readonly body: string }

/**
 * Verify R2 credentials by issuing a lightweight SigV4-signed
 * `ListObjectsV2` (max-keys=0) against the target bucket.
 *
 * Returns `{valid:true}` on HTTP 200, `{valid:false, status, body}` on
 * 401/403 so the caller can log the rejection reason (e.g. S3 error code)
 * before deciding to rotate. Any other status is treated as an
 * infrastructure error and propagates.
 */
export async function verifyR2Credentials(
	input: VerifyR2CredentialsInput,
): Promise<VerifyR2Result> {
	const signed = signSigV4Request({
		accessKeyId: input.accessKeyId,
		secretAccessKey: input.secretAccessKey,
		method: 'GET',
		host: computeR2Host(input.accountId),
		path: `/${input.bucketName}`,
		query: 'list-type=2&max-keys=0',
		region: 'auto',
		service: 's3',
		payload: '',
		now: new Date(),
	})

	const response = await fetch(signed.url, {
		method: 'GET',
		headers: signed.headers,
	})

	if (response.ok) return { valid: true }
	if (response.status === UNAUTHORIZED || response.status === FORBIDDEN) {
		const body = await response.text()
		return { valid: false, status: response.status, body }
	}

	const body = await response.text()
	throw new Error(
		`R2 credential verification for bucket "${input.bucketName}" returned ${String(response.status)}: ${body}`,
	)
}
