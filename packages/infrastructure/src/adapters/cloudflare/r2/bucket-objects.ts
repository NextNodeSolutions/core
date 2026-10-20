import { createHash } from 'node:crypto'

import { computeR2Host } from '#/domain/cloudflare/r2/addressing.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { fetchWithRetry } from '../api.ts'

import { signS3Request } from './s3-signer.ts'

import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { S3Credentials, S3Request } from './s3-signer.ts'

const logger = createLogger()

// The most keys one `ListObjectsV2` page and one `DeleteObjects` call carry.
const PAGE_SIZE = 1000
const HTTP_OK = 200
const HTTP_NOT_FOUND = 404
const KEY_PATTERN = /<Key>([^<]*)<\/Key>/g
const ERROR_PATTERN = /<Error>([\s\S]*?)<\/Error>/
const XML_ESCAPES: Readonly<Record<string, string>> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&apos;',
}
const XML_ENTITIES: Readonly<Record<string, string>> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&apos;': "'",
}

export interface R2S3Access {
	readonly accountId: string
	readonly credentials: S3Credentials
}

function escapeXml(text: string): string {
	return text.replaceAll(
		/[&<>"']/g,
		character => XML_ESCAPES[character] ?? character,
	)
}

function unescapeXml(text: string): string {
	return text.replaceAll(
		/&(?:amp|lt|gt|quot|apos);/g,
		entity => XML_ENTITIES[entity] ?? entity,
	)
}

// Keys are listed URL-encoded (`encoding-type=url`), so no character of a key
// can break the XML; `+` stands for a space in that encoding.
function decodeKey(encoded: string): string {
	return decodeURIComponent(unescapeXml(encoded).replaceAll('+', ' '))
}

async function sendS3(
	access: R2S3Access,
	request: Omit<S3Request, 'host'>,
	label: string,
): Promise<Response> {
	const host = computeR2Host(access.accountId)
	const signed: S3Request = { ...request, host }
	const query = new URLSearchParams(request.query).toString()
	const url = `https://${host}${request.path}${query ? `?${query}` : ''}`
	return fetchWithRetry(
		url,
		{
			method: request.method,
			headers: signS3Request(access.credentials, signed),
			...(request.body && { body: request.body }),
		},
		label,
	)
}

// The first page of keys, or undefined when the bucket does not exist.
async function listKeys(
	access: R2S3Access,
	bucket: string,
): Promise<ReadonlyArray<string> | undefined> {
	const response = await sendS3(
		access,
		{
			method: 'GET',
			path: `/${bucket}`,
			query: {
				'list-type': '2',
				'encoding-type': 'url',
				'max-keys': String(PAGE_SIZE),
			},
			body: '',
			headers: {},
		},
		`List the objects of R2 bucket "${bucket}"`,
	)
	const body = await response.text()
	if (response.status === HTTP_NOT_FOUND) return undefined
	if (response.status !== HTTP_OK) {
		throw new Error(
			`List the objects of R2 bucket "${bucket}": S3 returned HTTP ${String(response.status)}: ${body}`,
		)
	}
	return Array.from(body.matchAll(KEY_PATTERN), ([, key]) =>
		decodeKey(key ?? ''),
	)
}

// One `DeleteObjects` call for up to PAGE_SIZE keys. Quiet mode answers with
// the failures only, so any `<Error>` in a 200 is a failure to report.
async function deleteKeys(
	access: R2S3Access,
	bucket: string,
	keys: ReadonlyArray<string>,
): Promise<void> {
	const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${keys
		.map(key => `<Object><Key>${escapeXml(key)}</Key></Object>`)
		.join('')}</Delete>`
	const label = `Delete ${String(keys.length)} object(s) from R2 bucket "${bucket}"`
	const response = await sendS3(
		access,
		{
			method: 'POST',
			path: `/${bucket}`,
			query: { delete: '' },
			body,
			headers: {
				'content-md5': createHash('md5').update(body).digest('base64'),
			},
		},
		label,
	)
	const text = await response.text()
	if (response.status !== HTTP_OK)
		throw new Error(
			`${label}: S3 returned HTTP ${String(response.status)}: ${text}`,
		)
	const failure = ERROR_PATTERN.exec(text)?.[1]
	if (failure) throw new Error(`${label}: S3 refused an object: ${failure}`)
}

// Lists the first page and deletes it until a list comes back empty: R2
// listings are strongly consistent, so no cursor is needed.
async function emptyBucket(
	access: R2S3Access,
	bucket: string,
): Promise<string> {
	let deleted = 0
	for (;;) {
		// eslint-disable-next-line no-await-in-loop -- each page is listed after the previous one is deleted
		const keys = await listKeys(access, bucket)
		if (typeof keys === 'undefined') return `${bucket}: absent`
		if (!keys.length) return `${bucket}: ${String(deleted)} deleted`
		// eslint-disable-next-line no-await-in-loop -- see above
		await deleteKeys(access, bucket, keys)
		deleted += keys.length
	}
}

/**
 * Delete every object of each bucket through R2's S3 API, a thousand per
 * call, so that `terraform destroy` can delete the buckets: Cloudflare refuses
 * to delete a bucket that holds objects, and its Terraform provider has no
 * force option. A bucket already gone counts as empty.
 */
export async function emptyR2Buckets(
	access: R2S3Access,
	buckets: ReadonlyArray<string>,
): Promise<ResourceOutcome> {
	const details: Array<string> = []
	for (const bucket of buckets) {
		// eslint-disable-next-line no-await-in-loop -- buckets emptied one at a time keep the API load bounded
		const detail = await emptyBucket(access, bucket)
		logger.info(`R2 bucket ${detail}`)
		details.push(detail)
	}
	return { handled: details.length > 0, detail: details.join('; ') }
}
