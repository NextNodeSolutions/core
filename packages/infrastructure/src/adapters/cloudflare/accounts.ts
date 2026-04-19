import { CLOUDFLARE_API_BASE, cfFetchJson, requireArrayResult } from './api.ts'

function parseAccountId(item: unknown): string {
	if (typeof item !== 'object' || item === null) {
		throw new Error('Cloudflare account: item is not an object')
	}
	if (!('id' in item) || typeof item.id !== 'string') {
		throw new Error('Cloudflare account: id missing or not a string')
	}
	return item.id
}

/**
 * Resolve the Cloudflare account id reachable by the given API token.
 *
 * Fails fast if the token grants access to zero or multiple accounts: zero
 * indicates a misscoped token, multiple means we have no rule for picking
 * one, so the caller must set `CLOUDFLARE_ACCOUNT_ID` explicitly upstream.
 */
export async function resolveAccountId(token: string): Promise<string> {
	const context = 'Cloudflare accounts list'
	const data = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/accounts`,
		token,
		context,
	)

	const result = requireArrayResult(data, context)
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

	return parseAccountId(result[0])
}
