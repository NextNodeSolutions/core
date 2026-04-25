import {
	CLOUDFLARE_API_BASE,
	authHeaders,
	formatErrors,
	parseEnvelope,
	requireOk,
} from '@/adapters/cloudflare/api.ts'
import { HTTP_NOT_FOUND } from '@/adapters/http.ts'

export interface EnsureR2BucketInput {
	readonly token: string
	readonly accountId: string
	readonly bucketName: string
	readonly locationHint: string
}

/**
 * Ensure an R2 bucket exists. Idempotent: probes via GET, returns early if
 * the bucket is present (HTTP 200), creates it via POST otherwise.
 *
 * Returns `true` if the bucket was newly created, `false` if it already
 * existed — callers use this for logging + metrics.
 */
export async function ensureR2Bucket(
	input: EnsureR2BucketInput,
): Promise<boolean> {
	const checkUrl = `${CLOUDFLARE_API_BASE}/accounts/${input.accountId}/r2/buckets/${encodeURIComponent(input.bucketName)}`
	const checkResponse = await fetch(checkUrl, {
		headers: authHeaders(input.token),
	})

	if (checkResponse.ok) return false

	if (checkResponse.status !== HTTP_NOT_FOUND) {
		const body = await checkResponse.text()
		throw new Error(
			`Cloudflare R2 bucket check for "${input.bucketName}" returned ${String(checkResponse.status)}: ${body}`,
		)
	}

	const createResponse = await fetch(
		`${CLOUDFLARE_API_BASE}/accounts/${input.accountId}/r2/buckets`,
		{
			method: 'POST',
			headers: authHeaders(input.token),
			body: JSON.stringify({
				name: input.bucketName,
				locationHint: input.locationHint,
			}),
		},
	)
	await requireOk(createResponse)

	const data: unknown = await createResponse.json()
	const context = `Cloudflare R2 bucket create "${input.bucketName}"`
	const envelope = parseEnvelope(data, context)
	if (!envelope.success) {
		throw new Error(`${context} failed: ${formatErrors(envelope.errors)}`)
	}

	return true
}
