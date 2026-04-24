import {
	cloudflareGet,
	extractArrayResult,
} from '@/lib/adapters/cloudflare/client.ts'
import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import { ENV_KEYS, getEnv, requireEnv } from '@/lib/adapters/env.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

// Rejects tokens that reach 0 or >1 accounts: a multi-account token needs
// CLOUDFLARE_ACCOUNT_ID set explicitly to avoid picking the wrong one.
export const resolveAccountId = async (token: string): Promise<string> => {
	const context = 'Cloudflare accounts list'
	const data = await cloudflareGet('/accounts', token, context)
	const result = extractArrayResult(data, context)
	if (result.length === 0) {
		throw new Error(
			`${context}: token grants access to no accounts — check token scope`,
		)
	}
	if (result.length > 1) {
		throw new Error(
			`${context}: token grants access to ${String(result.length)} accounts — set CLOUDFLARE_ACCOUNT_ID to disambiguate`,
		)
	}
	const [first] = result
	if (!isRecord(first) || typeof first.id !== 'string') {
		throw new Error(`${context}: malformed account entry (missing id)`)
	}
	return first.id
}

// Accounts are resolved once per token and cached for the process lifetime.
// Re-resolution would issue a redundant `GET /accounts` on every page render.
let cachedClient: Promise<CloudflareClient> | null = null
let cachedToken: string | null = null

export const resolveCloudflareClient = (): Promise<CloudflareClient> => {
	const token = requireEnv(ENV_KEYS.CLOUDFLARE_API_TOKEN)
	if (cachedClient && cachedToken === token) return cachedClient
	cachedToken = token
	cachedClient = (async () => {
		const accountId =
			getEnv(ENV_KEYS.CLOUDFLARE_ACCOUNT_ID) ??
			(await resolveAccountId(token))
		return { accountId, token }
	})()
	return cachedClient
}
