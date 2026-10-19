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

/**
 * Longest delay a timer accepts. A longer one overflows, and the runtime fires
 * the timer almost at once.
 */
const MAX_TIMER_DELAY_MS = 2_147_483_647

interface IntegerRange {
	readonly min: number
	readonly max: number
	readonly allowed: string
}

const TIMER_DELAY_RANGE: IntegerRange = {
	min: 1,
	max: MAX_TIMER_DELAY_MS,
	allowed: `integers from 1 to ${MAX_TIMER_DELAY_MS}`,
}

const INTEGER_OPTION_RANGES = {
	batchSize: {
		min: 1,
		max: Number.MAX_SAFE_INTEGER,
		allowed: 'positive integers',
	},
	flushInterval: TIMER_DELAY_RANGE,
	timeout: TIMER_DELAY_RANGE,
	maxRetries: {
		min: 0,
		max: Number.MAX_SAFE_INTEGER,
		allowed: 'non-negative integers',
	},
} as const satisfies Record<string, IntegerRange>

/**
 * Validates that a numeric option, when given, is an integer within the range
 * its use needs.
 */
export const validateIntegerOption = (
	option: keyof typeof INTEGER_OPTION_RANGES,
	optionValue: number | undefined,
): void => {
	if (typeof optionValue === 'undefined') return

	const { min, max, allowed } = INTEGER_OPTION_RANGES[option]
	const isInRange =
		Number.isInteger(optionValue) &&
		optionValue >= min &&
		optionValue <= max
	if (isInRange) return

	throw new Error(
		`Invalid ${option} ${optionValue}. Only ${allowed} are allowed`,
	)
}
