import { createHash, createHmac } from 'node:crypto'

// AWS Signature Version 4 for R2's S3 API, which signs with the `auto`
// region. Only what the bucket emptying sends is covered: a method, a path, a
// query and a string body.

const SIGNING_ALGORITHM = 'AWS4-HMAC-SHA256'
const SIGNING_REGION = 'auto'
const SIGNING_SERVICE = 's3'
const SIGNING_TERMINATOR = 'aws4_request'
const DATE_STAMP_LENGTH = 8
const HEX_RADIX = 16
// `encodeURIComponent` leaves these, which SigV4 encodes.
const UNRESERVED_EXCEPTIONS = /[!'()*]/g

export interface S3Credentials {
	readonly accessKeyId: string
	readonly secretAccessKey: string
}

export interface S3Request {
	readonly method: 'GET' | 'POST'
	readonly host: string
	// The bucket and key path, raw: each segment is encoded here.
	readonly path: string
	readonly query: Readonly<Record<string, string>>
	readonly body: string
	// Extra headers, signed with the standard ones.
	readonly headers: Readonly<Record<string, string>>
}

function sha256Hex(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}

function hmac(key: Buffer | string, text: string): Buffer {
	return createHmac('sha256', key).update(text).digest()
}

function uriEncode(text: string): string {
	return encodeURIComponent(text).replace(
		UNRESERVED_EXCEPTIONS,
		character =>
			`%${character.charCodeAt(0).toString(HEX_RADIX).toUpperCase()}`,
	)
}

function canonicalPath(path: string): string {
	return path.split('/').map(uriEncode).join('/')
}

function canonicalQuery(query: Readonly<Record<string, string>>): string {
	return Object.entries(query)
		.map(([name, value]) => [uriEncode(name), uriEncode(value)] as const)
		.toSorted(([left], [right]) => left.localeCompare(right))
		.map(([name, value]) => `${name}=${value}`)
		.join('&')
}

// `YYYYMMDDTHHMMSSZ`, then its date part.
function amzDate(now: Date): string {
	return now.toISOString().replaceAll(/[-:]|\.\d{3}/g, '')
}

function signingKey(secretAccessKey: string, dateStamp: string): Buffer {
	const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp)
	const regionKey = hmac(dateKey, SIGNING_REGION)
	const serviceKey = hmac(regionKey, SIGNING_SERVICE)
	return hmac(serviceKey, SIGNING_TERMINATOR)
}

/** The headers of `request` signed with `credentials`, `Authorization` included. */
export function signS3Request(
	credentials: S3Credentials,
	request: S3Request,
	now: Date = new Date(),
): Record<string, string> {
	const timestamp = amzDate(now)
	const dateStamp = timestamp.slice(0, DATE_STAMP_LENGTH)
	const payloadHash = sha256Hex(request.body)
	const headers: Record<string, string> = {
		...Object.fromEntries(
			Object.entries(request.headers).map(([name, value]) => [
				name.toLowerCase(),
				value,
			]),
		),
		host: request.host,
		'x-amz-content-sha256': payloadHash,
		'x-amz-date': timestamp,
	}
	const signedNames = Object.keys(headers).toSorted()
	const canonicalHeaders = signedNames
		.map(name => `${name}:${headers[name]?.trim() ?? ''}\n`)
		.join('')
	const signedHeaders = signedNames.join(';')
	const canonicalRequest = [
		request.method,
		canonicalPath(request.path),
		canonicalQuery(request.query),
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join('\n')
	const scope = `${dateStamp}/${SIGNING_REGION}/${SIGNING_SERVICE}/${SIGNING_TERMINATOR}`
	const stringToSign = [
		SIGNING_ALGORITHM,
		timestamp,
		scope,
		sha256Hex(canonicalRequest),
	].join('\n')
	const signature = createHmac(
		'sha256',
		signingKey(credentials.secretAccessKey, dateStamp),
	)
		.update(stringToSign)
		.digest('hex')
	return {
		...headers,
		authorization: `${SIGNING_ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
	}
}
