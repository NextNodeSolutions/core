/**
 * Runtime type guards for NextNode Logger
 */

import type {
	DevelopmentLocationInfo,
	Environment,
	LogLevel,
	ProductionLocationInfo,
	RuntimeEnvironment,
} from './types.js'

export const isLogLevel = (value: unknown): value is LogLevel =>
	typeof value === 'string' &&
	['debug', 'info', 'warn', 'error'].includes(value)

export const isEnvironment = (value: unknown): value is Environment =>
	typeof value === 'string' && ['development', 'production'].includes(value)

export const isDevelopmentLocation = (
	location: DevelopmentLocationInfo | ProductionLocationInfo,
): location is DevelopmentLocationInfo =>
	'file' in location && 'line' in location

export const isRuntimeEnvironment = (
	value: unknown,
): value is RuntimeEnvironment =>
	typeof value === 'string' &&
	['node', 'browser', 'webworker', 'unknown'].includes(value)
