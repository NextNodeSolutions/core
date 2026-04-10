/**
 * NextNode Logger — public entry point.
 * Thin barrel that re-exports the full public API.
 */

// Core logger class + factory
export { createLogger } from './core/factory.js'
export { NextNodeLogger } from './core/nextnode-logger.js'

// Formatters
export type { BrowserLogOutput } from './formatters/console-browser.js'
export {
	createBrowserLogArgs,
	formatForBrowser,
} from './formatters/console-browser.js'
export { formatForNode } from './formatters/console-node.js'
export type { JsonLogOutput } from './formatters/json.js'
export { formatAsJson, formatAsJsonPretty } from './formatters/json.js'

// Transports
export type { ConsoleTransportConfig } from './transports/console.js'
export {
	ConsoleTransport,
	createConsoleTransport,
} from './transports/console.js'

// Types
export type {
	ChildLoggerConfig,
	DevelopmentLocationInfo,
	Environment,
	LogEntry,
	Logger,
	LoggerConfig,
	LogLevel,
	LogObject,
	ProductionLocationInfo,
	RuntimeEnvironment,
	SpyLogger,
	Transport,
} from './types.js'
export { LOG_LEVEL_PRIORITY } from './types.js'

// Utilities
export { generateRequestId } from './utils/crypto.js'
export {
	detectEnvironment,
	detectRuntime,
	hasCryptoSupport,
} from './utils/environment.js'
export { parseLocation } from './utils/location.js'
export { safeStringify } from './utils/serialization.js'
export { getCurrentTimestamp } from './utils/time.js'
