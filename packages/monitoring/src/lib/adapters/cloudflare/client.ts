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

const parseApiError = (item: unknown): CloudflareApiError => {
	if (!isRecord(item)) return { code: 0, message: 'unknown error' }
	const code = typeof item.code === 'number' ? item.code : 0
	const message =
		typeof item.message === 'string' ? item.message : 'unknown error'
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
		if (value === undefined) continue
		url.searchParams.set(key, String(value))
	}
	return url.toString()
}

const parseApiResponse = async (
	response: Response,
	context: string,
): Promise<unknown> => {
	const data: unknown = await response.json()
	if (!response.ok || !isRecord(data) || data.success !== true) {
		const errors =
			isRecord(data) && Array.isArray(data.errors)
				? data.errors.map(parseApiError)
				: []
		throw new CloudflareApiFailure(context, response.status, errors)
	}
	return data
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
	data: unknown,
	context: string,
): ReadonlyArray<unknown> => {
	if (!isRecord(data) || !Array.isArray(data.result)) {
		throw new Error(`${context}: \`result\` must be an array`)
	}
	return data.result
}

export const extractObjectResult = (
	data: unknown,
	context: string,
): Record<string, unknown> => {
	if (!isRecord(data) || !isRecord(data.result)) {
		throw new Error(`${context}: \`result\` must be an object`)
	}
	return data.result
}

const extractTotalPages = (data: unknown, context: string): number => {
	if (!isRecord(data) || !isRecord(data.result_info)) {
		throw new Error(
			`${context}: missing \`result_info\` — endpoint did not return pagination metadata`,
		)
	}
	const total = data.result_info.total_pages
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
 * chunk size — Cloudflare Pages endpoints enforce undocumented caps (see each
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
		const data = await apiGet(path, token, context, {
			per_page: perPage,
			page,
		})
		return {
			items: extractArrayResult(data, context),
			totalPages: extractTotalPages(data, context),
		}
	}
	const first = await fetchPage(1)
	if (first.totalPages <= 1) return first.items
	const pending: Array<
		Promise<{ items: ReadonlyArray<unknown>; totalPages: number }>
	> = []
	for (let page = 2; page <= first.totalPages; page++) {
		pending.push(fetchPage(page))
	}
	const rest = await Promise.all(pending)
	return [...first.items, ...rest.flatMap(page => page.items)]
}
