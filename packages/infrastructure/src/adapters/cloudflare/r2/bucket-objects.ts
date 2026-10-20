import { isRecord } from '#/kernel/guards.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'

const logger = createLogger()

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'
// The most objects one list call returns.
const LIST_PAGE_SIZE = 1000
// The REST API deletes one object per call: a page is deleted this many at a
// time.
const DELETE_CONCURRENCY = 16
const HTTP_NOT_FOUND = 404

export interface R2Access {
	readonly accountId: string
	readonly apiToken: string
}

function bucketUrl(access: R2Access, bucket: string): string {
	return `${CLOUDFLARE_API_BASE}/accounts/${access.accountId}/r2/buckets/${encodeURIComponent(bucket)}`
}

function authHeaders(access: R2Access): Record<string, string> {
	return { Authorization: `Bearer ${access.apiToken}` }
}

async function requireOk(response: Response, context: string): Promise<void> {
	if (response.ok) return
	const body = await response.text()
	throw new Error(
		`${context}: Cloudflare API returned ${String(response.status)}: ${body}`,
	)
}

function parseKeys(responseBody: unknown, context: string): Array<string> {
	if (!isRecord(responseBody) || !Array.isArray(responseBody['result']))
		throw new Error(`${context}: \`result\` must be an array`)
	return responseBody['result'].map(rawObject => {
		if (!isRecord(rawObject) || typeof rawObject['key'] !== 'string')
			throw new Error(`${context}: an object is missing \`key\``)
		return rawObject['key']
	})
}

// The first page of keys, or undefined when the bucket does not exist.
async function listKeys(
	access: R2Access,
	bucket: string,
): Promise<ReadonlyArray<string> | undefined> {
	const context = `List the objects of R2 bucket "${bucket}"`
	const query = new URLSearchParams({ per_page: String(LIST_PAGE_SIZE) })
	const response = await fetch(
		`${bucketUrl(access, bucket)}/objects?${query.toString()}`,
		{ headers: authHeaders(access) },
	)
	if (response.status === HTTP_NOT_FOUND) return undefined
	await requireOk(response, context)
	return parseKeys(await response.json(), context)
}

async function deleteObject(
	access: R2Access,
	bucket: string,
	key: string,
): Promise<void> {
	const response = await fetch(
		`${bucketUrl(access, bucket)}/objects/${encodeURIComponent(key)}`,
		{ method: 'DELETE', headers: authHeaders(access) },
	)
	if (response.status === HTTP_NOT_FOUND) return
	await requireOk(response, `Delete "${key}" from R2 bucket "${bucket}"`)
}

async function deleteKeys(
	access: R2Access,
	bucket: string,
	keys: ReadonlyArray<string>,
): Promise<void> {
	for (let start = 0; start < keys.length; start += DELETE_CONCURRENCY) {
		// eslint-disable-next-line no-await-in-loop -- one batch at a time bounds the concurrent calls
		await Promise.all(
			keys
				.slice(start, start + DELETE_CONCURRENCY)
				.map(key => deleteObject(access, bucket, key)),
		)
	}
}

// Lists the first page and deletes it until a list comes back empty: R2
// listings are strongly consistent, so no cursor is needed.
async function emptyBucket(access: R2Access, bucket: string): Promise<string> {
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
 * Delete every object of each bucket, so that `terraform destroy` can delete
 * the buckets: Cloudflare refuses to delete a bucket that holds objects, and
 * its Terraform provider has no force option. A bucket already gone counts as
 * empty.
 */
export async function emptyR2Buckets(
	access: R2Access,
	buckets: ReadonlyArray<string>,
): Promise<ResourceOutcome> {
	const details: Array<string> = []
	for (const bucket of buckets) {
		// eslint-disable-next-line no-await-in-loop -- buckets emptied one at a time keep the API load bounded
		const detail = await emptyBucket(access, bucket)
		logger.info(`R2 bucket ${detail}`)
		details.push(detail)
	}
	if (!details.length) return { handled: false, detail: 'no bucket' }
	return { handled: true, detail: details.join('; ') }
}
