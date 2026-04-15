import { createHash, createHmac } from 'node:crypto'

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

function hmacSha256(key: Buffer | string, data: string): Buffer {
	return createHmac('sha256', key).update(data).digest()
}

function sha256Hex(data: string): string {
	return createHash('sha256').update(data).digest('hex')
}

const DATE_STAMP_LENGTH = 8

function formatAmzDate(now: Date): string {
	return now
		.toISOString()
		.replaceAll(/[-:]/g, '')
		.replace(/\.\d{3}/, '')
}

export function signSigV4Request(input: SigV4RequestInput): SigV4SignedRequest {
	const amzDate = formatAmzDate(input.now)
	const dateStamp = amzDate.slice(0, DATE_STAMP_LENGTH)
	const payloadHash = sha256Hex(input.payload)

	const canonicalHeaders = `host:${input.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
	const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'

	const canonicalRequest = [
		input.method,
		input.path,
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

	const url = `https://${input.host}${input.path}${input.query ? `?${input.query}` : ''}`
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
