/**
 * Core Logger class for NextNode Logger
 * Zero dependencies, strict TypeScript, production-ready logging with scope support
 */

import { ConsoleTransport } from "./transports/console.js";
import type {
	ChildLoggerConfig,
	Environment,
	LogEntry,
	Logger,
	LoggerConfig,
	LogLevel,
	LogObject,
	Transport,
} from "./types.js";
import { LOG_LEVEL_PRIORITY } from "./types.js";
import { generateRequestId } from "./utils/crypto.js";
import { detectEnvironment, parseLocation } from "./utils/location.js";
import { extractScope } from "./utils/scope.js";
import { getCurrentTimestamp } from "./utils/time.js";

/**
 * NextNode Logger - A lightweight, zero-dependency TypeScript logger
 */
export class NextNodeLogger implements Logger {
	private readonly environment: Environment;
	private readonly prefix?: string;
	private readonly scope?: string;
	private readonly includeLocation: boolean;
	private readonly minLevel: LogLevel;
	private readonly silent: boolean;
	private readonly transports: Transport[];
	private readonly requestId: string;

	constructor(config: LoggerConfig = {}) {
		this.environment = config.environment ?? detectEnvironment();
		if (config.prefix !== undefined) {
			this.prefix = config.prefix;
		}
		if (config.scope !== undefined) {
			this.scope = config.scope;
		}
		this.includeLocation = config.includeLocation ?? this.environment === "development";
		this.minLevel = config.minLevel ?? "debug";
		this.silent = config.silent ?? false;
		this.requestId = config.requestId ?? generateRequestId();

		// Use provided transports or default to console
		this.transports = config.transports ?? [
			new ConsoleTransport({ environment: this.environment }),
		];
	}

	private shouldLog(level: LogLevel): boolean {
		if (this.silent) return false;
		return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
	}

	private createLogEntry(level: LogLevel, message: string, object?: LogObject): LogEntry {
		const {
			scope: perCallScope,
			requestId: perCallRequestId,
			cleanObject,
		} = extractScope(object);

		// Add prefix to message if configured
		const finalMessage = this.prefix ? `${this.prefix} ${message}` : message;

		return {
			level,
			message: finalMessage,
			timestamp: getCurrentTimestamp(),
			location: this.includeLocation ? parseLocation(false) : parseLocation(true),
			requestId: perCallRequestId ?? this.requestId,
			scope: perCallScope ?? this.scope,
			object: cleanObject,
		};
	}

	private log(level: LogLevel, message: string, object?: LogObject): void {
		if (!this.shouldLog(level)) return;

		const entry = this.createLogEntry(level, message, object);

		for (const transport of this.transports) {
			try {
				transport.log(entry);
			} catch (error) {
				console.error(
					`[NextNodeLogger] Transport failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	debug(message: string, object?: LogObject): void {
		this.log("debug", message, object);
	}

	info(message: string, object?: LogObject): void {
		this.log("info", message, object);
	}

	warn(message: string, object?: LogObject): void {
		this.log("warn", message, object);
	}

	error(message: string, object?: LogObject): void {
		this.log("error", message, object);
	}

	child(config: ChildLoggerConfig): NextNodeLogger {
		const childPrefix = config.prefix ?? this.prefix;
		const childScope = config.scope ?? this.scope;

		return new NextNodeLogger({
			environment: this.environment,
			includeLocation: this.includeLocation,
			minLevel: config.minLevel ?? this.minLevel,
			silent: this.silent,
			transports: this.transports,
			requestId: config.requestId ?? this.requestId,
			...(childPrefix !== undefined && { prefix: childPrefix }),
			...(childScope !== undefined && { scope: childScope }),
		});
	}

	/**
	 * Disposes all transports that support disposal.
	 * Call this when shutting down to flush any buffered logs.
	 */
	async dispose(): Promise<void> {
		const disposals = this.transports
			.filter((t) => t.dispose !== undefined)
			.map((t) => t.dispose!());

		await Promise.all(disposals);
	}
}

/**
 * Factory function for creating logger instances.
 *
 * @example
 * // Basic usage
 * const logger = createLogger()
 * logger.info('Hello world')
 *
 * @example
 * // With configuration
 * const logger = createLogger({
 *   minLevel: 'warn',  // Only log warn and error
 *   prefix: '[MyApp]',
 *   environment: 'production'
 * })
 *
 * @example
 * // Silent mode for tests
 * const logger = createLogger({ silent: true })
 *
 * @example
 * // With custom transports
 * import { HttpTransport } from '@nextnode/logger/transports/http'
 * const logger = createLogger({
 *   transports: [
 *     new ConsoleTransport(),
 *     new HttpTransport({ endpoint: 'https://logs.example.com' })
 *   ]
 * })
 */
export const createLogger = (config?: LoggerConfig): NextNodeLogger => new NextNodeLogger(config);

/**
 * Default logger instance for immediate use.
 *
 * @example
 * import { logger } from '@nextnode/logger'
 *
 * logger.info('Application started')
 * logger.warn('Something might be wrong', { details: { code: 123 } })
 * logger.error('Something went wrong', { scope: 'api', details: error })
 */
export const logger = createLogger();

export type { BrowserLogOutput } from "./formatters/console-browser.js";
export { createBrowserLogArgs, formatForBrowser } from "./formatters/console-browser.js";
// Re-export formatters
export { formatForNode } from "./formatters/console-node.js";
export type { JsonLogOutput } from "./formatters/json.js";
export { formatAsJson, formatAsJsonPretty } from "./formatters/json.js";
export type { ConsoleTransportConfig } from "./transports/console.js";
// Re-export transports
export { ConsoleTransport, createConsoleTransport } from "./transports/console.js";
// Re-export types for convenience
export type {
	ChildLoggerConfig,
	DevelopmentLocationInfo,
	Environment,
	LocationInfo,
	LogEntry,
	Logger,
	LoggerConfig,
	LogLevel,
	LogObject,
	ProductionLocationInfo,
	RuntimeEnvironment,
	SpyLogger,
	Transport,
} from "./types.js";
export { LOG_LEVEL_PRIORITY } from "./types.js";
// Re-export utilities
export { generateRequestId } from "./utils/crypto.js";
export { detectRuntime, hasCryptoSupport } from "./utils/environment.js";
export { detectEnvironment, parseLocation } from "./utils/location.js";
export { safeStringify } from "./utils/serialization.js";
export { getCurrentTimestamp } from "./utils/time.js";
