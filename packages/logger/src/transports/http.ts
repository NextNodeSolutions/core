/**
 * HTTP transport for NextNode Logger
 * Sends logs to a remote endpoint with batching and error handling
 */

import { stringifyJson } from '../utils/serialization.js'

import {
	validateBufferCapacity,
	validateEndpoint,
	validateHeaders,
	validateIntegerOption,
} from './http-validation.js'

import type { LogEntry, Transport } from '../types.js'

export interface HttpTransportConfig {
	/**
	 * The URL endpoint to send logs to.
	 */
	endpoint: string

	/**
	 * Additional headers to include in requests.
	 */
	headers?: Record<string, string>

	/**
	 * Number of logs to batch before sending. Must be a positive integer.
	 * Defaults to 10.
	 */
	batchSize?: number

	/**
	 * Maximum time (in ms) to wait before flushing the buffer. Must be an
	 * integer from 1 to the longest timer delay, 2147483647.
	 * Defaults to 5000 (5 seconds).
	 */
	flushInterval?: number

	/**
	 * Called when a request fails.
	 * Receives the error and the entries that failed to send.
	 */
	onError?: (error: Error, entries: LogEntry[]) => void

	/**
	 * Called when a batch is successfully sent.
	 * Receives the number of entries sent.
	 */
	onSuccess?: (count: number) => void

	/**
	 * Request timeout in milliseconds. Must be an integer from 1 to the longest
	 * timer delay, 2147483647.
	 * Defaults to 10000 (10 seconds).
	 */
	timeout?: number

	/**
	 * Number of retries after a failed first attempt, so a batch gets up to
	 * `maxRetries + 1` attempts. Each retry waits twice as long as the one
	 * before, from 100 ms up to 30 seconds. Must be a non-negative integer.
	 * Defaults to 3.
	 */
	maxRetries?: number

	/**
	 * Maximum number of entries the buffer holds while a batch is in flight.
	 * When it is full, each new entry drops the oldest one, and onError
	 * receives a DroppedEntriesError with the count once the flush settles.
	 * Must be an integer no smaller than batchSize.
	 * Defaults to 1000, or to batchSize when that is larger.
	 */
	maxBufferSize?: number
}

/**
 * The error onError receives after the buffer dropped entries. The dropped
 * entries are not kept, so that memory stays bounded, and only their count is
 * reported, with an empty entry list.
 */
export class DroppedEntriesError extends Error {
	readonly droppedCount: number

	constructor(droppedCount: number) {
		super(`Buffer full, dropped the oldest log entries: ${droppedCount}`)
		this.name = 'DroppedEntriesError'
		this.droppedCount = droppedCount
	}
}

const DEFAULT_BATCH_SIZE = 10
const DEFAULT_FLUSH_INTERVAL = 5000
const DEFAULT_TIMEOUT = 10000
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_MAX_BUFFER_SIZE = 1000

const INITIAL_BACKOFF_MS = 100
/**
 * Longest wait between two attempts. Without it the doubling delay of a long
 * retry run would overflow the timer, which then fires almost at once.
 */
const MAX_BACKOFF_MS = 30_000

/**
 * Fully-resolved HTTP transport configuration with all defaults applied.
 * Used internally after merging user config with defaults.
 */
interface ResolvedHttpTransportConfig {
	readonly endpoint: string
	readonly headers?: Record<string, string>
	readonly batchSize: number
	readonly flushInterval: number
	readonly timeout: number
	readonly maxRetries: number
	readonly maxBufferSize: number
	readonly onError?: (error: Error, entries: LogEntry[]) => void
	readonly onSuccess?: (count: number) => void
}

interface SerializedBatch {
	readonly body: string
	readonly entries: LogEntry[]
}

const resolveConfig = (
	config: HttpTransportConfig,
): ResolvedHttpTransportConfig => {
	const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE

	return {
		endpoint: config.endpoint,
		batchSize,
		flushInterval: config.flushInterval ?? DEFAULT_FLUSH_INTERVAL,
		timeout: config.timeout ?? DEFAULT_TIMEOUT,
		maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
		maxBufferSize:
			config.maxBufferSize ??
			Math.max(DEFAULT_MAX_BUFFER_SIZE, batchSize),
		...(config.headers && { headers: config.headers }),
		...(config.onError && { onError: config.onError }),
		...(config.onSuccess && { onSuccess: config.onSuccess }),
	}
}

export class HttpTransport implements Transport {
	private readonly config: ResolvedHttpTransportConfig

	private buffer: LogEntry[] = []
	private flushTimer: ReturnType<typeof setTimeout> | null = null
	private inFlightFlush: Promise<void> | undefined
	private droppedCount = 0

	constructor(config: HttpTransportConfig) {
		// Validate configuration before storing
		validateEndpoint(config.endpoint)
		validateHeaders(config.headers)
		validateIntegerOption('batchSize', config.batchSize)
		validateIntegerOption('flushInterval', config.flushInterval)
		validateIntegerOption('timeout', config.timeout)
		validateIntegerOption('maxRetries', config.maxRetries)
		validateIntegerOption('maxBufferSize', config.maxBufferSize)

		this.config = resolveConfig(config)
		validateBufferCapacity(this.config.maxBufferSize, this.config.batchSize)

		// Start flush interval timer
		this.startFlushTimer()
	}

	log(entry: LogEntry): void {
		this.buffer.push(entry)

		if (this.buffer.length >= this.config.batchSize) {
			void this.flush()
		}

		// A flush that starts takes the whole buffer at once, so the buffer stays
		// over its limit only while a batch is in flight.
		if (this.buffer.length > this.config.maxBufferSize) {
			this.buffer.shift()
			this.droppedCount++
		}
	}

	async flush(): Promise<void> {
		if (this.inFlightFlush || !this.buffer.length) {
			return
		}

		const batch = this.serializeBatch(this.buffer)
		this.buffer = []
		this.inFlightFlush = this.deliver(batch)

		try {
			await this.inFlightFlush
		} finally {
			this.inFlightFlush = undefined
		}

		this.reportDrops()
	}

	async dispose(): Promise<void> {
		this.stopFlushTimer()

		// A flush requested while another runs is skipped, so the final one
		// starts only once no flush is in flight.
		while (this.inFlightFlush) {
			await this.inFlightFlush
		}

		await this.flush()
	}

	private startFlushTimer(): void {
		this.flushTimer = setInterval(() => {
			void this.flush()
		}, this.config.flushInterval)

		// Don't keep the process alive just for logging
		if (typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
			this.flushTimer.unref()
		}
	}

	private stopFlushTimer(): void {
		if (this.flushTimer) {
			clearInterval(this.flushTimer)
			this.flushTimer = null
		}
	}

	private serializeBatch(entries: readonly LogEntry[]): SerializedBatch {
		const serializedEntries: string[] = []
		const sendableEntries: LogEntry[] = []

		for (const entry of entries) {
			try {
				serializedEntries.push(stringifyJson(entry))
				sendableEntries.push(entry)
			} catch (error) {
				// Business rule: an entry whose getter or toJSON method throws is
				// reported alone, so it cannot cost the rest of its batch.
				this.reportLoss(error, [entry])
			}
		}

		return {
			body: `{"logs":[${serializedEntries.join(',')}]}`,
			entries: sendableEntries,
		}
	}

	private async deliver(batch: SerializedBatch): Promise<void> {
		if (!batch.entries.length) return

		try {
			await this.sendWithRetry(batch.body)
		} catch (error) {
			// Business rule: nothing awaits a flush started by the timer or a full
			// batch, so a lost batch goes to onError instead of rejecting.
			this.reportLoss(error, batch.entries)
			return
		}

		this.callHook('onSuccess', () =>
			this.config.onSuccess?.(batch.entries.length),
		)
	}

	private reportDrops(): void {
		if (!this.droppedCount) return

		const error = new DroppedEntriesError(this.droppedCount)
		this.droppedCount = 0
		this.reportLoss(error, [])
	}

	private reportLoss(error: unknown, entries: LogEntry[]): void {
		const lossError =
			error instanceof Error ? error : new Error(String(error))
		this.callHook('onError', () =>
			this.config.onError?.(lossError, entries),
		)
	}

	private callHook(
		hookName: 'onError' | 'onSuccess',
		invokeHook: () => void,
	): void {
		try {
			invokeHook()
		} catch (error) {
			// Business rule: a hook is caller code, so its throw is reported here
			// and never rejects the flush, which nothing awaits after a timer tick
			// or a full batch.
			console.error(
				`[logger] HTTP transport ${hookName} hook threw: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	private async backoffBeforeRetry(attempt: number): Promise<void> {
		const isLastAttempt = attempt >= this.config.maxRetries
		if (isLastAttempt) return

		// Exponential backoff: 100ms, 200ms, 400ms, etc., up to the cap
		await this.sleep(
			Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS),
		)
	}

	private async sendWithRetry(body: string): Promise<void> {
		let lastError: unknown

		for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
			try {
				await this.send(body)
				return
			} catch (error) {
				lastError = error
				await this.backoffBeforeRetry(attempt)
			}
		}

		throw lastError
	}

	private async send(body: string): Promise<void> {
		const controller = new AbortController()
		const timeoutId = setTimeout(
			() => controller.abort(),
			this.config.timeout,
		)

		try {
			const response = await fetch(this.config.endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...this.config.headers,
				},
				body,
				signal: controller.signal,
			})

			if (!response.ok) {
				throw new Error(
					`HTTP ${response.status}: ${response.statusText}`,
				)
			}
		} finally {
			clearTimeout(timeoutId)
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms))
	}
}

/**
 * Creates an HTTP transport with the specified configuration.
 */
export const createHttpTransport = (
	config: HttpTransportConfig,
): HttpTransport => new HttpTransport(config)
