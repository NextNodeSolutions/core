/**
 * Runtime constants for NextNode Logger
 */

import type { LogLevel } from './types.js'

/**
 * Log level priority ordering. Higher values have higher severity.
 * Used for filtering logs below a configured minimum level.
 */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
} as const
