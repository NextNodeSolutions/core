/**
 * Console transport for NextNode Logger
 * Resolves the output format from environment + runtime + config,
 * then delegates rendering to an injectable ConsoleWriter strategy.
 */

import { detectRuntime } from '../utils/environment.js'

import { DEFAULT_CONSOLE_WRITERS } from './console-writers.js'

import type { Environment, LogEntry, LogLevel, Transport } from '../types.js'
import type {
	ConsoleFormat,
	ConsoleMethod,
	ConsoleWriter,
} from './console-writers.js'

// Console methods mapping for type safety
const CONSOLE_METHODS: Record<LogLevel, ConsoleMethod> = {
	debug: 'debug',
	info: 'log',
	warn: 'warn',
	error: 'error',
} as const

type FormatOption = ConsoleFormat | 'auto'

export interface ConsoleTransportConfig {
	/**
	 * Environment whose output rules apply. 'production' always outputs JSON.
	 * The transport never reads NODE_ENV, so an omitted value follows the
	 * development rules.
	 */
	environment?: Environment | undefined

	/**
	 * Force output format regardless of runtime.
	 * Ignored when `environment` is 'production', which always outputs JSON.
	 * - 'auto': Detect runtime and use appropriate format (default)
	 * - 'node': Use ANSI colors (for Node.js terminals)
	 * - 'browser': Use CSS styling (for DevTools)
	 * - 'json': Output JSON (for log aggregation)
	 */
	format?: FormatOption | undefined

	/**
	 * Override the default writer for one or more formats.
	 * Useful for testing or routing output through a different channel.
	 */
	writers?: Partial<Record<ConsoleFormat, ConsoleWriter>> | undefined
}

export class ConsoleTransport implements Transport {
	private readonly config: ConsoleTransportConfig
	private readonly runtime: ReturnType<typeof detectRuntime>
	private readonly writers: Record<ConsoleFormat, ConsoleWriter>

	constructor(config: ConsoleTransportConfig = {}) {
		this.config = config
		this.runtime = detectRuntime()
		this.writers = {
			...DEFAULT_CONSOLE_WRITERS,
			...config.writers,
		}
	}

	log(entry: LogEntry): void {
		const method = CONSOLE_METHODS[entry.level]
		const format = this.resolveFormat()
		this.writers[format](entry, method)
	}

	private resolveFormat(): ConsoleFormat {
		const requested: FormatOption = this.config.format ?? 'auto'

		// Production always emits JSON, even when another format is forced
		if (this.config.environment === 'production' && requested !== 'json') {
			return 'json'
		}

		if (requested !== 'auto') return requested

		if (this.runtime === 'browser' || this.runtime === 'webworker') {
			return 'browser'
		}

		return 'node'
	}
}

/**
 * Creates a console transport with the specified configuration.
 */
export const createConsoleTransport = (
	config?: ConsoleTransportConfig,
): ConsoleTransport => new ConsoleTransport(config)
