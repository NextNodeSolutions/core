import { CLOUDFLARE_API_BASE, cfFetchJson, requireArrayResult } from './api.ts'

function parseAccountId(rawAccount: unknown): string {
	if (typeof rawAccount !== 'object' || rawAccount === null) {
		throw new Error('Cloudflare account: item is not an object')
	}
	if (!('id' in rawAccount) || typeof rawAccount.id !== 'string') {
		throw new Error('Cloudflare account: id missing or not a string')
	}
	return rawAccount.id
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
	const responseBody = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/accounts`,
		token,
		context,
	)

	const accounts = requireArrayResult(responseBody, context)
	if (accounts.length === 0) {
		throw new Error(
			`${context}: token grants access to no accounts - check token scope`,
		)
	}
	if (accounts.length > 1) {
		throw new Error(
			`${context}: token grants access to ${String(accounts.length)} accounts - set CLOUDFLARE_ACCOUNT_ID to disambiguate`,
		)
	}

	return parseAccountId(accounts[0])
}
