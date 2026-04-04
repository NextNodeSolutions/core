/**
 * Console transport for NextNode Logger
 * Auto-detects runtime environment and uses appropriate formatter
 */

import { formatForBrowser } from '../formatters/console-browser.js'
import { formatForNode } from '../formatters/console-node.js'
import { formatAsJson } from '../formatters/json.js'
import type { Environment, LogEntry, LogLevel, Transport } from '../types.js'
import { detectRuntime } from '../utils/environment.js'

// Console methods mapping for type safety
const CONSOLE_METHODS: Record<
	LogLevel,
	keyof Pick<Console, 'log' | 'warn' | 'error' | 'debug'>
> = {
	debug: 'debug',
	info: 'log',
	warn: 'warn',
	error: 'error',
} as const

export interface ConsoleTransportConfig {
	/**
	 * Force a specific environment format.
	 * If not specified, auto-detects based on NODE_ENV.
	 */
	environment?: Environment

	/**
	 * Force output format regardless of runtime.
	 * - 'auto': Detect runtime and use appropriate format (default)
	 * - 'node': Always use ANSI colors (for Node.js terminals)
	 * - 'browser': Always use CSS styling (for DevTools)
	 * - 'json': Always output JSON (for log aggregation)
	 */
	format?: 'auto' | 'node' | 'browser' | 'json'
}

export class ConsoleTransport implements Transport {
	private readonly config: ConsoleTransportConfig
	private readonly runtime: ReturnType<typeof detectRuntime>

	constructor(config: ConsoleTransportConfig = {}) {
		this.config = config
		this.runtime = detectRuntime()
	}

	log(entry: LogEntry): void {
		const method = CONSOLE_METHODS[entry.level]
		const format = this.config.format ?? 'auto'
		const environment = this.config.environment

		// Production always uses JSON regardless of format setting
		if (environment === 'production' && format !== 'json') {
			console[method](formatAsJson(entry))
			return
		}

		// Explicit format override
		if (format === 'json') {
			console[method](formatAsJson(entry))
			return
		}

		if (format === 'node') {
			console[method](formatForNode(entry))
			return
		}

		if (format === 'browser') {
			this.logBrowser(entry, method)
			return
		}

		// Auto-detect based on runtime
		if (this.runtime === 'browser' || this.runtime === 'webworker') {
			this.logBrowser(entry, method)
			return
		}

		// Node.js or unknown - use ANSI
		console[method](formatForNode(entry))
	}

	private logBrowser(
		entry: LogEntry,
		method: keyof Pick<Console, 'log' | 'warn' | 'error' | 'debug'>,
	): void {
		const { format, styles, objects } = formatForBrowser(entry)

		if (objects.length > 0) {
			console.groupCollapsed(format, ...styles)
			for (const obj of objects) {
				console.dir(obj, { depth: null })
			}
			console.groupEnd()
		} else {
			console[method](format, ...styles)
		}
	}
}

/**
 * Creates a console transport with the specified configuration.
 */
export const createConsoleTransport = (
	config?: ConsoleTransportConfig,
): ConsoleTransport => new ConsoleTransport(config)
