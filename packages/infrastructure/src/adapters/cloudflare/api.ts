import { setTimeout as sleep } from 'node:timers/promises'

import { createLogger } from '@nextnode-solutions/logger'
import {
	array,
	boolean,
	number,
	object,
	optional,
	safeParse,
	string,
	unknown,
} from 'valibot'

import type { GenericSchema, InferOutput } from 'valibot'

const logger = createLogger()

export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4'

export interface CloudflareApiAccess {
	readonly accountId: string
	readonly apiToken: string
}

const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_INTERNAL_SERVER_ERROR = 500
const HTTP_BAD_GATEWAY = 502
const HTTP_SERVICE_UNAVAILABLE = 503
const HTTP_GATEWAY_TIMEOUT = 504
// A rate limit (1200 requests per five minutes per token) or a transient
// failure, retried with a bounded backoff that honours `Retry-After`.
const RETRIED_STATUSES: ReadonlySet<number> = new Set([
	HTTP_TOO_MANY_REQUESTS,
	HTTP_INTERNAL_SERVER_ERROR,
	HTTP_BAD_GATEWAY,
	HTTP_SERVICE_UNAVAILABLE,
	HTTP_GATEWAY_TIMEOUT,
])
const MAX_ATTEMPTS = 5
const RETRY_BASE_MS = 1000
const RETRY_FACTOR = 2
const RETRY_MAX_MS = 30_000
const MS_PER_SECOND = 1000

const envelopeSchema = object({
	success: boolean(),
	errors: optional(
		array(object({ code: optional(number()), message: string() })),
		[],
	),
	result: unknown(),
	result_info: unknown(),
})

export type CloudflareEnvelope = InferOutput<typeof envelopeSchema> & {
	readonly status: number
}

function retryDelayMs(response: Response, attempt: number): number {
	const retryAfter = Number(response.headers.get('retry-after'))
	if (Number.isFinite(retryAfter) && retryAfter > 0)
		return Math.min(retryAfter * MS_PER_SECOND, RETRY_MAX_MS)
	return Math.min(RETRY_BASE_MS * RETRY_FACTOR ** (attempt - 1), RETRY_MAX_MS)
}

async function backOff(
	response: Response,
	attempt: number,
	label: string,
): Promise<void> {
	const delay = retryDelayMs(response, attempt)
	logger.warn(
		`${label}: HTTP ${String(response.status)}, retrying in ${String(delay)} ms (attempt ${String(attempt)} of ${String(MAX_ATTEMPTS)})`,
	)
	await response.body?.cancel()
	await sleep(delay)
}

/**
 * `fetch` against a Cloudflare endpoint (REST or S3), retried on a rate limit
 * or a transient failure. The body must be reusable across attempts: a string
 * or none.
 */
export async function fetchWithRetry(
	url: string,
	init: RequestInit,
	label: string,
): Promise<Response> {
	for (let attempt = 1; ; attempt += 1) {
		// eslint-disable-next-line no-await-in-loop -- each attempt waits for the previous response
		const response = await fetch(url, init)
		if (!RETRIED_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS)
			return response
		// eslint-disable-next-line no-await-in-loop -- a bounded backoff between attempts
		await backOff(response, attempt, label)
	}
}

function parseEnvelope(
	text: string,
	status: number,
	label: string,
): CloudflareEnvelope {
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch {
		throw new Error(
			`${label}: Cloudflare API returned HTTP ${String(status)} with a non-JSON body:\n${text}`,
		)
	}
	const envelope = safeParse(envelopeSchema, parsed)
	if (!envelope.success) {
		throw new Error(
			`${label}: Cloudflare API returned HTTP ${String(status)} with an unexpected body:\n${text}`,
		)
	}
	return { ...envelope.output, status }
}

export interface CloudflareRequest {
	readonly method: 'GET' | 'POST'
	readonly path: string
	// Sent as JSON.
	readonly body?: unknown
}

/** Call a REST endpoint and read its `{ success, errors, result }` envelope. */
export async function cloudflareRequest(
	access: CloudflareApiAccess,
	request: CloudflareRequest,
	label: string,
): Promise<CloudflareEnvelope> {
	const hasBody = typeof request.body !== 'undefined'
	const response = await fetchWithRetry(
		`${CLOUDFLARE_API_BASE}${request.path}`,
		{
			method: request.method,
			headers: {
				authorization: `Bearer ${access.apiToken}`,
				...(hasBody && { 'content-type': 'application/json' }),
			},
			...(hasBody && { body: JSON.stringify(request.body) }),
		},
		label,
	)
	return parseEnvelope(await response.text(), response.status, label)
}

export function cloudflareGet(
	access: CloudflareApiAccess,
	path: string,
	label: string,
): Promise<CloudflareEnvelope> {
	return cloudflareRequest(access, { method: 'GET', path }, label)
}

/** The `result` of a successful envelope, checked against `schema`. */
export function readResult<T>(
	envelope: CloudflareEnvelope,
	schema: GenericSchema<unknown, T>,
	label: string,
): T {
	if (!envelope.success) {
		const errors = envelope.errors
			.map(error =>
				typeof error.code === 'undefined'
					? error.message
					: `${String(error.code)}: ${error.message}`,
			)
			.join('; ')
		throw new Error(
			`${label}: Cloudflare API returned HTTP ${String(envelope.status)}: ${errors}`,
		)
	}
	const parsedResult = safeParse(schema, envelope.result)
	if (!parsedResult.success) {
		throw new Error(
			`${label}: unexpected \`result\` shape:\n${JSON.stringify(envelope.result)}`,
		)
	}
	return parsedResult.output
}
