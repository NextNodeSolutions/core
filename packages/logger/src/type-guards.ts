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

export const isLogLevel = (candidate: unknown): candidate is LogLevel =>
	typeof candidate === 'string' &&
	['debug', 'info', 'warn', 'error'].includes(candidate)

export const isEnvironment = (candidate: unknown): candidate is Environment =>
	typeof candidate === 'string' &&
	['development', 'production'].includes(candidate)

export const isDevelopmentLocation = (
	location: DevelopmentLocationInfo | ProductionLocationInfo,
): location is DevelopmentLocationInfo =>
	'file' in location && 'line' in location

export const isRuntimeEnvironment = (
	candidate: unknown,
): candidate is RuntimeEnvironment =>
	typeof candidate === 'string' &&
	['node', 'browser', 'webworker', 'unknown'].includes(candidate)
