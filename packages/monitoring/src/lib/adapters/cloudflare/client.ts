import { UpstreamApiFailure } from '@/lib/adapters/upstream-api-failure.ts'
import { isRecord } from '@/lib/domain/is-record.ts'

export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'

export interface CloudflareClient {
	readonly accountId: string
	readonly token: string
}

export interface CloudflareApiError {
	readonly code: number
	readonly message: string
}

export class CloudflareApiFailure extends UpstreamApiFailure {
	constructor(
		context: string,
		httpStatus: number,
		public readonly apiErrors: ReadonlyArray<CloudflareApiError>,
	) {
		super(
			context,
			httpStatus,
			`${context} failed (HTTP ${String(httpStatus)}): ${formatErrors(apiErrors) || 'no detail'}`,
		)
	}

	logContext(): Record<string, unknown> {
		return { apiErrors: this.apiErrors }
	}
}

const authHeaders = (token: string): Record<string, string> => ({
	Authorization: `Bearer ${token}`,
	'Content-Type': 'application/json',
})

const parseApiError = (rawError: unknown): CloudflareApiError => {
	if (!isRecord(rawError)) return { code: 0, message: 'unknown error' }
	const code = typeof rawError.code === 'number' ? rawError.code : 0
	const message =
		typeof rawError.message === 'string'
			? rawError.message
			: 'unknown error'
	return { code, message }
}

const formatErrors = (errors: ReadonlyArray<CloudflareApiError>): string =>
	errors.map(err => `[${String(err.code)}] ${err.message}`).join('; ')

const buildUrl = (
	path: string,
	query?: Record<string, string | number | undefined>,
): string => {
	const url = new URL(`${CLOUDFLARE_API_BASE}${path}`)
	if (!query) return url.toString()
	for (const [key, value] of Object.entries(query)) {
		if (typeof value === 'undefined') continue
		url.searchParams.set(key, String(value))
	}
	return url.toString()
}

const parseApiResponse = async (
	response: Response,
	context: string,
): Promise<unknown> => {
	const body: unknown = await response.json()
	if (!response.ok || !isRecord(body) || body.success !== true) {
		const errors =
			isRecord(body) && Array.isArray(body.errors)
				? body.errors.map(parseApiError)
				: []
		throw new CloudflareApiFailure(context, response.status, errors)
	}
	return body
}

export const apiGet = async (
	path: string,
	token: string,
	context: string,
	query?: Record<string, string | number | undefined>,
): Promise<unknown> => {
	const response = await fetch(buildUrl(path, query), {
		headers: authHeaders(token),
	})
	return parseApiResponse(response, context)
}

export const apiPost = async (
	path: string,
	token: string,
	context: string,
	body: Record<string, unknown> = {},
): Promise<unknown> => {
	const response = await fetch(buildUrl(path), {
		method: 'POST',
		headers: authHeaders(token),
		body: JSON.stringify(body),
	})
	return parseApiResponse(response, context)
}

export const apiDelete = async (
	path: string,
	token: string,
	context: string,
): Promise<unknown> => {
	const response = await fetch(buildUrl(path), {
		method: 'DELETE',
		headers: authHeaders(token),
	})
	return parseApiResponse(response, context)
}

export const extractArrayResult = (
	envelope: unknown,
	context: string,
): ReadonlyArray<unknown> => {
	if (!isRecord(envelope) || !Array.isArray(envelope.result)) {
		throw new Error(`${context}: \`result\` must be an array`)
	}
	return envelope.result
}

export const extractObjectResult = (
	envelope: unknown,
	context: string,
): Record<string, unknown> => {
	if (!isRecord(envelope) || !isRecord(envelope.result)) {
		throw new Error(`${context}: \`result\` must be an object`)
	}
	return envelope.result
}

const extractTotalPages = (envelope: unknown, context: string): number => {
	if (!isRecord(envelope) || !isRecord(envelope.result_info)) {
		throw new Error(
			`${context}: missing \`result_info\` - endpoint did not return pagination metadata`,
		)
	}
	const total = envelope.result_info.total_pages
	if (typeof total !== 'number' || total < 1) {
		throw new Error(
			`${context}: invalid \`result_info.total_pages\` (got ${String(total)})`,
		)
	}
	return total
}

/**
 * Fetch every page of a paginated Cloudflare list endpoint and return the
 * concatenated array. Callers pass the endpoint's maximum `per_page` as the
 * chunk size - Cloudflare Pages endpoints enforce undocumented caps (see each
 * adapter for the measured value), so auto-pagination here is the only way to
 * surface the full data set without silent truncation.
 */
export const listAll = async (
	path: string,
	token: string,
	context: string,
	perPage: number,
): Promise<ReadonlyArray<unknown>> => {
	const fetchPage = async (
		page: number,
	): Promise<{ items: ReadonlyArray<unknown>; totalPages: number }> => {
		const envelope = await apiGet(path, token, context, {
			per_page: perPage,
			page,
		})
		return {
			items: extractArrayResult(envelope, context),
			totalPages: extractTotalPages(envelope, context),
		}
	}
	const first = await fetchPage(1)
	if (first.totalPages <= 1) return first.items
	// page 1 is already fetched; follow-up pages start right after it
	const FIRST_FOLLOW_UP_PAGE = 2
	const pending: Array<
		Promise<{ items: ReadonlyArray<unknown>; totalPages: number }>
	> = []
	for (let page = FIRST_FOLLOW_UP_PAGE; page <= first.totalPages; page++) {
		pending.push(fetchPage(page))
	}
	const rest = await Promise.all(pending)
	return [...first.items, ...rest.flatMap(page => page.items)]
}
