/**
 * HTTP transport for NextNode Logger
 * Sends logs to a remote endpoint with batching and error handling
 */

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
	 * Number of logs to batch before sending.
	 * Defaults to 10.
	 */
	batchSize?: number

	/**
	 * Maximum time (in ms) to wait before flushing the buffer.
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
	 * Request timeout in milliseconds.
	 * Defaults to 10000 (10 seconds).
	 */
	timeout?: number

	/**
	 * Maximum number of retry attempts for failed requests.
	 * Defaults to 3.
	 */
	maxRetries?: number
}

const DEFAULT_BATCH_SIZE = 10
const DEFAULT_FLUSH_INTERVAL = 5000
const DEFAULT_TIMEOUT = 10000
const DEFAULT_MAX_RETRIES = 3

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
	readonly onError?: (error: Error, entries: LogEntry[]) => void
	readonly onSuccess?: (count: number) => void
}

const resolveConfig = (
	config: HttpTransportConfig,
): ResolvedHttpTransportConfig => ({
	endpoint: config.endpoint,
	batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
	flushInterval: config.flushInterval ?? DEFAULT_FLUSH_INTERVAL,
	timeout: config.timeout ?? DEFAULT_TIMEOUT,
	maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
	...(config.headers !== undefined && { headers: config.headers }),
	...(config.onError !== undefined && { onError: config.onError }),
	...(config.onSuccess !== undefined && { onSuccess: config.onSuccess }),
})

export class HttpTransport implements Transport {
	private readonly config: ResolvedHttpTransportConfig

	private buffer: LogEntry[] = []
	private flushTimer: ReturnType<typeof setTimeout> | null = null
	private isFlushing = false

	constructor(config: HttpTransportConfig) {
		// Validate configuration before storing
		this.validateEndpoint(config.endpoint)
		this.validateHeaders(config.headers)

		this.config = resolveConfig(config)

		// Start flush interval timer
		this.startFlushTimer()
	}

	/**
	 * Validates that the endpoint is a valid HTTP or HTTPS URL.
	 * Prevents SSRF attacks by rejecting non-HTTP protocols.
	 */
	private validateEndpoint(endpoint: string): void {
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
	private validateHeaders(headers?: Record<string, string>): void {
		if (!headers) return

		for (const key of Object.keys(headers)) {
			if (RESTRICTED_HEADERS.has(key.toLowerCase())) {
				throw new Error(
					`Header "${key}" is restricted and cannot be overridden`,
				)
			}
		}
	}

	log(entry: LogEntry): void {
		this.buffer.push(entry)

		if (this.buffer.length >= this.config.batchSize) {
			void this.flush()
		}
	}

	async flush(): Promise<void> {
		if (this.isFlushing || this.buffer.length === 0) {
			return
		}

		this.isFlushing = true
		const entries = [...this.buffer]
		this.buffer = []

		try {
			await this.sendWithRetry(entries)
			this.config.onSuccess?.(entries.length)
		} catch (error) {
			this.config.onError?.(
				error instanceof Error ? error : new Error(String(error)),
				entries,
			)
		} finally {
			this.isFlushing = false
		}
	}

	async dispose(): Promise<void> {
		this.stopFlushTimer()
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

	private async sendWithRetry(entries: LogEntry[]): Promise<void> {
		let lastError: Error | null = null

		for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
			try {
				await this.send(entries)
				return
			} catch (error) {
				lastError =
					error instanceof Error ? error : new Error(String(error))

				// Exponential backoff: 100ms, 200ms, 400ms, etc.
				if (attempt < this.config.maxRetries - 1) {
					await this.sleep(100 * 2 ** attempt)
				}
			}
		}

		throw lastError ?? new Error('Failed to send logs after retries')
	}

	private async send(entries: LogEntry[]): Promise<void> {
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
				body: JSON.stringify({ logs: entries }),
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
