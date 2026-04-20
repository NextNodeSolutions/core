import {
	cloudflareGet,
	extractArrayResult,
} from '@/lib/adapters/cloudflare/client.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

/**
 * Resolve the Cloudflare account id reachable by the given API token.
 *
 * Fails fast if the token grants access to zero or multiple accounts: zero
 * indicates a misscoped token, multiple means the caller must set
 * `CLOUDFLARE_ACCOUNT_ID` explicitly upstream.
 */
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
