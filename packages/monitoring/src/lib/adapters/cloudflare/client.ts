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

export const buildCloudflareUrl = (
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

export const cloudflareGet = async (
	path: string,
	token: string,
	context: string,
	query?: Record<string, string | number | undefined>,
): Promise<unknown> => {
	const response = await fetch(buildCloudflareUrl(path, query), {
		headers: authHeaders(token),
	})
	const data: unknown = await response.json()
	if (!response.ok) {
		const errors =
			isRecord(data) && Array.isArray(data.errors)
				? data.errors.map(parseApiError)
				: []
		throw new CloudflareApiFailure(context, response.status, errors)
	}
	if (!isRecord(data) || data.success !== true) {
		const errors =
			isRecord(data) && Array.isArray(data.errors)
				? data.errors.map(parseApiError)
				: []
		throw new CloudflareApiFailure(context, response.status, errors)
	}
	return data
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
