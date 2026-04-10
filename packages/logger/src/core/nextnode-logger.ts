/**
 * Core NextNodeLogger class
 * Orchestrates log level filtering, entry creation, and transport dispatch.
 */

import { ConsoleTransport } from '../transports/console.js'
import type {
	ChildLoggerConfig,
	Environment,
	LogEntry,
	Logger,
	LoggerConfig,
	LogLevel,
	LogObject,
	Transport,
} from '../types.js'
import { LOG_LEVEL_PRIORITY } from '../types.js'
import { generateRequestId } from '../utils/crypto.js'
import { detectEnvironment } from '../utils/environment.js'
import { parseLocation } from '../utils/location.js'
import { extractScope } from '../utils/scope.js'
import { getCurrentTimestamp } from '../utils/time.js'

export class NextNodeLogger implements Logger {
	private readonly environment: Environment
	private readonly prefix?: string
	private readonly scope?: string
	private readonly includeLocation: boolean
	private readonly minLevel: LogLevel
	private readonly silent: boolean
	private readonly transports: Transport[]
	private readonly requestId: string

	constructor(config: LoggerConfig = {}) {
		this.environment = config.environment ?? detectEnvironment()
		if (config.prefix !== undefined) {
			this.prefix = config.prefix
		}
		if (config.scope !== undefined) {
			this.scope = config.scope
		}
		this.includeLocation =
			config.includeLocation ?? this.environment === 'development'
		this.minLevel = config.minLevel ?? 'debug'
		this.silent = config.silent ?? false
		this.requestId = config.requestId ?? generateRequestId()

		this.transports = config.transports ?? [
			new ConsoleTransport({ environment: this.environment }),
		]
	}

	private shouldLog(level: LogLevel): boolean {
		if (this.silent) return false
		return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel]
	}

	private createLogEntry(
		level: LogLevel,
		message: string,
		object?: LogObject,
	): LogEntry {
		const {
			scope: perCallScope,
			requestId: perCallRequestId,
			cleanObject,
		} = extractScope(object)

		const finalMessage = this.prefix ? `${this.prefix} ${message}` : message

		return {
			level,
			message: finalMessage,
			timestamp: getCurrentTimestamp(),
			location: this.includeLocation
				? parseLocation(false)
				: parseLocation(true),
			requestId: perCallRequestId ?? this.requestId,
			scope: perCallScope ?? this.scope,
			object: cleanObject,
		}
	}

	private log(level: LogLevel, message: string, object?: LogObject): void {
		if (!this.shouldLog(level)) return

		const entry = this.createLogEntry(level, message, object)

		for (const transport of this.transports) {
			try {
				transport.log(entry)
			} catch (error) {
				console.error(
					`[NextNodeLogger] Transport failed: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}
	}

	debug(message: string, object?: LogObject): void {
		this.log('debug', message, object)
	}

	info(message: string, object?: LogObject): void {
		this.log('info', message, object)
	}

	warn(message: string, object?: LogObject): void {
		this.log('warn', message, object)
	}

	error(message: string, object?: LogObject): void {
		this.log('error', message, object)
	}

	child(config: ChildLoggerConfig): NextNodeLogger {
		const childPrefix = config.prefix ?? this.prefix
		const childScope = config.scope ?? this.scope

		return new NextNodeLogger({
			environment: this.environment,
			includeLocation: this.includeLocation,
			minLevel: config.minLevel ?? this.minLevel,
			silent: this.silent,
			transports: this.transports,
			requestId: config.requestId ?? this.requestId,
			...(childPrefix !== undefined && { prefix: childPrefix }),
			...(childScope !== undefined && { scope: childScope }),
		})
	}

	/**
	 * Disposes all transports that support disposal.
	 * Call this when shutting down to flush any buffered logs.
	 */
	async dispose(): Promise<void> {
		const disposals = this.transports
			.filter(t => t.dispose !== undefined)
			.map(t => t.dispose!())

		await Promise.all(disposals)
	}
}
