import { createHash, createHmac } from 'node:crypto'

/**
 * Minimal AWS SigV4 request signer - just enough to GET objects from the
 * R2 state bucket. Mirrors packages/infrastructure/src/domain/aws/sigv4.ts
 * (that package is never published, so the pure signer is duplicated
 * rather than imported across the deploy boundary).
 *
 * Pure: the clock is injected via `now` so tests stay deterministic.
 */
export interface SigV4RequestInput {
	readonly accessKeyId: string
	readonly secretAccessKey: string
	readonly method: string
	readonly host: string
	readonly path: string
	readonly query: string
	readonly region: string
	readonly service: string
	readonly payload: string
	readonly now: Date
}

export interface SigV4SignedRequest {
	readonly url: string
	readonly headers: Record<string, string>
}

const hmacSha256 = (key: Buffer | string, message: string): Buffer =>
	createHmac('sha256', key).update(message).digest()

const sha256Hex = (message: string): string =>
	createHash('sha256').update(message).digest('hex')

const DATE_STAMP_LENGTH = 8
const HEX_RADIX = 16

/**
 * AWS SigV4 canonical URI: each path segment is RFC 3986-encoded with the
 * slashes preserved (S3/R2 use single-pass encoding). `encodeURIComponent`
 * already leaves the unreserved set `A-Za-z0-9-_.~` intact and percent-encodes
 * the rest, except `!*'()` which AWS also requires encoded. The same encoded
 * path must go into both the canonical request and the request URL so the
 * server re-derives the identical signature. For inert keys (the only ones we
 * sign today) this is a no-op.
 */
const encodeCanonicalUri = (path: string): string =>
	path
		.split('/')
		.map(segment =>
			encodeURIComponent(segment).replaceAll(
				/[!*'()]/g,
				char => `%${char.charCodeAt(0).toString(HEX_RADIX).toUpperCase()}`,
			),
		)
		.join('/')

const formatAmzDate = (now: Date): string =>
	now
		.toISOString()
		.replaceAll(/[-:]/g, '')
		.replace(/\.\d{3}/, '')

export const signSigV4Request = (
	input: SigV4RequestInput,
): SigV4SignedRequest => {
	const amzDate = formatAmzDate(input.now)
	const dateStamp = amzDate.slice(0, DATE_STAMP_LENGTH)
	const payloadHash = sha256Hex(input.payload)
	const canonicalUri = encodeCanonicalUri(input.path)

	const canonicalHeaders = `host:${input.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
	const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'

	const canonicalRequest = [
		input.method,
		canonicalUri,
		input.query,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join('\n')

	const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`
	const stringToSign = [
		'AWS4-HMAC-SHA256',
		amzDate,
		credentialScope,
		sha256Hex(canonicalRequest),
	].join('\n')

	const signingKey = hmacSha256(
		hmacSha256(
			hmacSha256(
				hmacSha256(`AWS4${input.secretAccessKey}`, dateStamp),
				input.region,
			),
			input.service,
		),
		'aws4_request',
	)
	const signature = hmacSha256(signingKey, stringToSign).toString('hex')

	const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

	const url = `https://${input.host}${canonicalUri}${input.query ? `?${input.query}` : ''}`
	return {
		url,
		headers: {
			Host: input.host,
			'x-amz-date': amzDate,
			'x-amz-content-sha256': payloadHash,
			Authorization: authorization,
		},
	}
}
