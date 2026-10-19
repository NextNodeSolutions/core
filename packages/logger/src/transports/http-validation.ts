/**
 * Configuration checks for the HTTP transport
 * Each check throws an Error that names the bad value, so a misconfigured
 * transport fails in its constructor
 */

/**
 * Headers that cannot be overridden by user configuration.
 * These are either security-sensitive or managed by the transport.
 */
const RESTRICTED_HEADERS = new Set([
	'host',
	'content-length',
	'transfer-encoding',
])

/**
 * Validates that the endpoint is a valid HTTP or HTTPS URL.
 * Prevents SSRF attacks by rejecting non-HTTP protocols.
 */
export const validateEndpoint = (endpoint: string): void => {
	let url: URL
	try {
		url = new URL(endpoint)
	} catch {
		throw new Error(`Invalid endpoint URL: ${endpoint}`)
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(
			`Invalid protocol "${url.protocol}". Only http: and https: are allowed`,
		)
	}
}

/**
 * Validates that custom headers don't include restricted headers.
 * Prevents header injection attacks.
 */
export const validateHeaders = (headers?: Record<string, string>): void => {
	if (!headers) return

	for (const key of Object.keys(headers)) {
		if (RESTRICTED_HEADERS.has(key.toLowerCase())) {
			throw new Error(
				`Header "${key}" is restricted and cannot be overridden`,
			)
		}
	}
}

export const validateMaxRetries = (maxRetries?: number): void => {
	if (typeof maxRetries === 'undefined') return

	if (!Number.isInteger(maxRetries) || maxRetries < 0) {
		throw new Error(
			`Invalid maxRetries ${maxRetries}. Only non-negative integers are allowed`,
		)
	}
}
