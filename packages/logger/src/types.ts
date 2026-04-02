/**
 * Core types for NextNode Logger
 * Zero dependencies, strict TypeScript, production-ready logging
 */

// Literal union types for better type inference
export type LogLevel = "debug" | "info" | "warn" | "error";
export type Environment = "development" | "production";
export type RuntimeEnvironment = "node" | "browser" | "webworker" | "unknown";

// Log level priority for filtering
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
} as const;

// Location information types with discriminated union
export interface DevelopmentLocationInfo {
	readonly file: string;
	readonly line: number;
	readonly function: string;
}

export interface ProductionLocationInfo {
	readonly function: string;
}

// Backward compatibility alias
export type LocationInfo = DevelopmentLocationInfo;

// Log object with optional fields
export interface LogObject {
	readonly scope?: string;
	readonly details?: unknown;
	readonly status?: number;
	readonly requestId?: string;
	readonly [key: string]: unknown;
}

// Log entry with conditional types for better type safety
// Note: Using `| undefined` explicitly for exactOptionalPropertyTypes compatibility
export interface LogEntry {
	readonly level: LogLevel;
	readonly message: string;
	readonly timestamp: string;
	readonly location: DevelopmentLocationInfo | ProductionLocationInfo;
	readonly requestId: string;
	readonly scope?: string | undefined;
	readonly object?: Omit<LogObject, "scope"> | undefined;
}

// Transport interface for pluggable log destinations
export interface Transport {
	log(entry: LogEntry): void | Promise<void>;
	dispose?(): void | Promise<void>;
}

// Logger configuration with strict typing
export interface LoggerConfig {
	readonly prefix?: string;
	readonly scope?: string;
	readonly environment?: Environment;
	readonly includeLocation?: boolean;
	readonly minLevel?: LogLevel;
	readonly silent?: boolean;
	readonly transports?: Transport[];
	readonly requestId?: string;
}

// Configuration for child loggers
export interface ChildLoggerConfig {
	readonly scope?: string;
	readonly prefix?: string;
	readonly minLevel?: LogLevel;
	readonly requestId?: string;
}

// Logger interface with method signatures
export interface Logger {
	debug(message: string, object?: LogObject): void;
	info(message: string, object?: LogObject): void;
	warn(message: string, object?: LogObject): void;
	error(message: string, object?: LogObject): void;
	child(config: ChildLoggerConfig): Logger;
}

// Spy logger interface for testing
export interface SpyLogger extends Logger {
	readonly calls: LogEntry[];
	getCallsByLevel(level: LogLevel): LogEntry[];
	getLastCall(): LogEntry | undefined;
	wasCalledWith(message: string): boolean;
	wasCalledWithLevel(level: LogLevel, message: string): boolean;
	clear(): void;
	child(config: ChildLoggerConfig): SpyLogger;
}

// Type guards for runtime type checking
export const isLogLevel = (value: unknown): value is LogLevel =>
	typeof value === "string" && ["debug", "info", "warn", "error"].includes(value);

export const isEnvironment = (value: unknown): value is Environment =>
	typeof value === "string" && ["development", "production"].includes(value);

export const isDevelopmentLocation = (
	location: DevelopmentLocationInfo | ProductionLocationInfo,
): location is DevelopmentLocationInfo => "file" in location && "line" in location;

export const isRuntimeEnvironment = (value: unknown): value is RuntimeEnvironment =>
	typeof value === "string" && ["node", "browser", "webworker", "unknown"].includes(value);
