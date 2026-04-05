export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'

export interface CloudflareApiError {
	readonly code: number
	readonly message: string
}

export interface EnvelopeFields {
	readonly success: boolean
	readonly errors: ReadonlyArray<CloudflareApiError>
}

export function authHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
	}
}

export async function requireOk(response: Response): Promise<void> {
	if (response.ok) return
	const body = await response.text()
	throw new Error(`Cloudflare API returned ${response.status}: ${body}`)
}

function parseApiError(item: unknown): CloudflareApiError {
	if (typeof item !== 'object' || item === null) {
		return { code: 0, message: 'unknown error' }
	}
	const code = 'code' in item && typeof item.code === 'number' ? item.code : 0
	const message =
		'message' in item && typeof item.message === 'string'
			? item.message
			: 'unknown error'
	return { code, message }
}

export function formatErrors(
	errors: ReadonlyArray<CloudflareApiError>,
): string {
	return errors.map(err => `[${err.code}] ${err.message}`).join('; ')
}

export function parseEnvelope(data: unknown, context: string): EnvelopeFields {
	if (typeof data !== 'object' || data === null) {
		throw new Error(`${context}: response body is not an object`)
	}
	if (!('success' in data) || typeof data.success !== 'boolean') {
		throw new Error(`${context}: missing or invalid \`success\` field`)
	}
	const errors: ReadonlyArray<CloudflareApiError> =
		'errors' in data && Array.isArray(data.errors)
			? data.errors.map(parseApiError)
			: []
	return { success: data.success, errors }
}

export function requireArrayResult(
	data: unknown,
	context: string,
): ReadonlyArray<unknown> {
	if (typeof data !== 'object' || data === null) {
		throw new Error(`${context}: response body is not an object`)
	}
	if (!('result' in data) || !Array.isArray(data.result)) {
		throw new Error(`${context}: \`result\` must be an array`)
	}
	return data.result
}

export function requireObjectResult(data: unknown, context: string): object {
	if (typeof data !== 'object' || data === null) {
		throw new Error(`${context}: response body is not an object`)
	}
	if (
		!('result' in data) ||
		typeof data.result !== 'object' ||
		data.result === null
	) {
		throw new Error(`${context}: \`result\` must be an object`)
	}
	return data.result
}
