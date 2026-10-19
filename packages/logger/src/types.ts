/**
 * Core type definitions for NextNode Logger.
 * This file contains pure compile-time types only.
 * Runtime constants live in `./constants.ts` and type guards in `./type-guards.ts`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type Environment = 'development' | 'production'
export type RuntimeEnvironment = 'node' | 'browser' | 'webworker' | 'unknown'

export interface DevelopmentLocationInfo {
	readonly file: string
	readonly line: number
	readonly function: string
}

export interface ProductionLocationInfo {
	readonly function: string
}

export interface LogObject {
	readonly scope?: string | undefined
	readonly details?: unknown
	readonly status?: number | undefined
	readonly requestId?: string | undefined
	readonly [key: string]: unknown
}

// Using `| undefined` explicitly for exactOptionalPropertyTypes compatibility
export interface LogEntry {
	readonly level: LogLevel
	readonly message: string
	readonly timestamp: string
	readonly location: DevelopmentLocationInfo | ProductionLocationInfo
	readonly requestId: string
	readonly scope?: string | undefined
	readonly object?: Omit<LogObject, 'scope'> | undefined
}

export interface Transport {
	log(entry: LogEntry): void | Promise<void>
	dispose?(): void | Promise<void>
}

export interface LoggerConfig {
	readonly prefix?: string | undefined
	readonly scope?: string | undefined
	readonly environment?: Environment | undefined
	readonly includeLocation?: boolean | undefined
	readonly minLevel?: LogLevel | undefined
	readonly silent?: boolean | undefined
	readonly transports?: Transport[] | undefined
	readonly requestId?: string | undefined
}

export interface ChildLoggerConfig {
	readonly scope?: string | undefined
	readonly prefix?: string | undefined
	readonly minLevel?: LogLevel | undefined
	readonly requestId?: string | undefined
}

export interface Logger {
	debug(message: string, object?: LogObject): void
	info(message: string, object?: LogObject): void
	warn(message: string, object?: LogObject): void
	error(message: string, object?: LogObject): void
	child(config: ChildLoggerConfig): Logger
}

export interface SpyLogger extends Logger {
	readonly calls: LogEntry[]
	getCallsByLevel(level: LogLevel): LogEntry[]
	getLastCall(): LogEntry | undefined
	wasCalledWith(message: string): boolean
	wasCalledWithLevel(level: LogLevel, message: string): boolean
	clear(): void
	child(config: ChildLoggerConfig): SpyLogger
}
