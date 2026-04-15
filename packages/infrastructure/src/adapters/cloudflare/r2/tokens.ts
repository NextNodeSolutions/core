import type { CloudflareTokenResult } from '../../../domain/cloudflare/r2/credentials.ts'
import type { R2PermissionGroupIds } from '../../../domain/cloudflare/r2/token-policy.ts'
import { buildR2TokenPolicy } from '../../../domain/cloudflare/r2/token-policy.ts'
import {
	CLOUDFLARE_API_BASE,
	authHeaders,
	formatErrors,
	parseEnvelope,
	requireArrayResult,
	requireObjectResult,
	requireOk,
} from '../api.ts'

export interface CreateR2TokenInput {
	readonly token: string
	readonly tokenName: string
	readonly accountId: string
	readonly bucketNames: ReadonlyArray<string>
	readonly permissions: R2PermissionGroupIds
}

function parseTokenResult(item: unknown): CloudflareTokenResult {
	if (typeof item !== 'object' || item === null) {
		throw new Error('Cloudflare R2 token response: result is not an object')
	}
	if (!('id' in item) || typeof item.id !== 'string') {
		throw new Error('Cloudflare R2 token response: id missing')
	}
	if (!('value' in item) || typeof item.value !== 'string') {
		throw new Error('Cloudflare R2 token response: value missing')
	}
	return { id: item.id, value: item.value }
}

/**
 * Create a Cloudflare API token scoped to one or more R2 buckets via
 * `POST /user/tokens`. Returns the raw token id + value so the caller can
 * derive S3-compatible credentials via `deriveR2Credentials`.
 *
 * The token persists on the Cloudflare account until revoked.
 */
export async function createR2Token(
	input: CreateR2TokenInput,
): Promise<CloudflareTokenResult> {
	const body = buildR2TokenPolicy({
		tokenName: input.tokenName,
		accountId: input.accountId,
		bucketNames: input.bucketNames,
		permissions: input.permissions,
	})

	const response = await fetch(`${CLOUDFLARE_API_BASE}/user/tokens`, {
		method: 'POST',
		headers: authHeaders(input.token),
		body: JSON.stringify(body),
	})
	await requireOk(response)

	const data: unknown = await response.json()
	const context = `Cloudflare R2 token create "${input.tokenName}"`
	const envelope = parseEnvelope(data, context)
	if (!envelope.success) {
		throw new Error(`${context} failed: ${formatErrors(envelope.errors)}`)
	}

	return parseTokenResult(requireObjectResult(data, context))
}

export interface ListedToken {
	readonly id: string
	readonly name: string
	readonly status: string
}

function parseListedToken(item: unknown): ListedToken {
	if (typeof item !== 'object' || item === null) {
		throw new Error('Cloudflare list tokens: item is not an object')
	}
	if (!('id' in item) || typeof item.id !== 'string') {
		throw new Error('Cloudflare list tokens: id missing')
	}
	if (!('name' in item) || typeof item.name !== 'string') {
		throw new Error('Cloudflare list tokens: name missing')
	}
	if (!('status' in item) || typeof item.status !== 'string') {
		throw new Error('Cloudflare list tokens: status missing')
	}
	return { id: item.id, name: item.name, status: item.status }
}

/**
 * List all tokens owned by the caller via `GET /user/tokens`.
 * Used to locate stale tokens by name before rotating.
 */
export async function listUserTokens(
	cfToken: string,
): Promise<ReadonlyArray<ListedToken>> {
	const response = await fetch(`${CLOUDFLARE_API_BASE}/user/tokens`, {
		headers: authHeaders(cfToken),
	})
	await requireOk(response)

	const data: unknown = await response.json()
	const context = 'Cloudflare list user tokens'
	const envelope = parseEnvelope(data, context)
	if (!envelope.success) {
		throw new Error(`${context} failed: ${formatErrors(envelope.errors)}`)
	}

	return requireArrayResult(data, context).map(parseListedToken)
}

/**
 * Revoke a single API token via `DELETE /user/tokens/{id}`.
 * Used after rotation to clean up superseded tokens.
 */
export async function deleteUserToken(
	cfToken: string,
	tokenId: string,
): Promise<void> {
	const response = await fetch(
		`${CLOUDFLARE_API_BASE}/user/tokens/${encodeURIComponent(tokenId)}`,
		{
			method: 'DELETE',
			headers: authHeaders(cfToken),
		},
	)
	await requireOk(response)

	const data: unknown = await response.json()
	const context = `Cloudflare delete token "${tokenId}"`
	const envelope = parseEnvelope(data, context)
	if (!envelope.success) {
		throw new Error(`${context} failed: ${formatErrors(envelope.errors)}`)
	}
}
