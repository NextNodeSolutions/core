import type { Logger } from '@nextnode-solutions/logger'

import type { IngestedLogEntry } from '../domain/log-envelope.ts'

export interface EnrichedLogEntry extends IngestedLogEntry {
	readonly client_id: string
	readonly project: string
	readonly tenant_tier: string
}

export interface VictoriaLogsClient {
	push(entries: ReadonlyArray<EnrichedLogEntry>): Promise<void>
}

export interface VictoriaLogsClientOptions {
	readonly endpoint: string
	readonly logger: Logger
	readonly fetchImpl?: typeof fetch
	readonly sleepImpl?: (ms: number) => Promise<void>
	readonly maxRetries?: number
	readonly backoffBaseMs?: number
}

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BACKOFF_BASE_MS = 100
const BACKOFF_MULTIPLIER = 2
const RETRY_STATUS_MIN = 500
const RETRY_STATUS_MAX = 599

/**
 * Internal marker for HTTP 4xx responses. 4xx means the request is malformed
 * and will never succeed — re-sending is pointless, so we short-circuit the
 * retry loop by throwing this class and catching it at the top level.
 */
class TerminalHttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message)
		this.name = 'TerminalHttpError'
	}
}

function toNdjson(entries: ReadonlyArray<EnrichedLogEntry>): string {
	return entries.map(entry => JSON.stringify(entry)).join('\n')
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise(resolve => {
		setTimeout(resolve, ms)
	})
}

export function createVictoriaLogsClient(
	options: VictoriaLogsClientOptions,
): VictoriaLogsClient {
	const {
		endpoint,
		logger,
		fetchImpl = fetch,
		sleepImpl = defaultSleep,
		maxRetries = DEFAULT_MAX_RETRIES,
		backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
	} = options

	async function attemptOnce(body: string): Promise<void> {
		const response = await fetchImpl(endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/stream+json' },
			body,
		})
		if (response.ok) return

		const message = `VictoriaLogs HTTP ${response.status}: ${response.statusText}`
		if (
			response.status < RETRY_STATUS_MIN ||
			response.status > RETRY_STATUS_MAX
		) {
			throw new TerminalHttpError(response.status, message)
		}
		// 5xx → retryable, plain Error.
		throw new Error(message)
	}

	async function attemptWithRetry(
		body: string,
		entryCount: number,
		attempt: number,
	): Promise<void> {
		try {
			await attemptOnce(body)
			logger.debug('victorialogs.push.ok', {
				count: entryCount,
				attempt,
			})
			return
		} catch (err) {
			if (err instanceof TerminalHttpError) {
				logger.error('victorialogs.push.terminal', {
					status: err.status,
					error: err.message,
				})
				throw err
			}
			const error = err instanceof Error ? err : new Error(String(err))
			if (attempt >= maxRetries - 1) {
				logger.error('victorialogs.push.exhausted', {
					attempts: maxRetries,
					error: error.message,
				})
				throw error
			}
			logger.warn('victorialogs.push.retry', {
				attempt,
				maxRetries,
				error: error.message,
			})
			await sleepImpl(backoffBaseMs * BACKOFF_MULTIPLIER ** attempt)
			return attemptWithRetry(body, entryCount, attempt + 1)
		}
	}

	async function push(
		entries: ReadonlyArray<EnrichedLogEntry>,
	): Promise<void> {
		if (entries.length === 0) return
		await attemptWithRetry(toNdjson(entries), entries.length, 0)
	}

	return { push }
}
