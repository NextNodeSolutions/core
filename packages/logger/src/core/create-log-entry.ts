/**
 * Pure log entry builder.
 * Shared between the production logger and the spy logger used in tests.
 */

import type { LogEntry, LogLevel, LogObject } from '../types.js'
import { parseLocation } from '../utils/location.js'
import { extractScope } from '../utils/scope.js'
import { getCurrentTimestamp } from '../utils/time.js'

export interface CreateLogEntryOptions {
	readonly level: LogLevel
	readonly message: string
	readonly object?: LogObject | undefined
	readonly defaultRequestId: string
	readonly defaultScope?: string | undefined
	readonly prefix?: string | undefined
	readonly includeLocation?: boolean | undefined
}

/**
 * Builds a structured LogEntry from a log call.
 *
 * Per-call scope and requestId (extracted from the LogObject) take precedence
 * over the defaults provided by the logger instance.
 */
export const createLogEntry = (options: CreateLogEntryOptions): LogEntry => {
	const {
		level,
		message,
		object,
		defaultRequestId,
		defaultScope,
		prefix,
		includeLocation = true,
	} = options

	const {
		scope: perCallScope,
		requestId: perCallRequestId,
		cleanObject,
	} = extractScope(object)

	const finalMessage = prefix ? `${prefix} ${message}` : message

	return {
		level,
		message: finalMessage,
		timestamp: getCurrentTimestamp(),
		location: includeLocation ? parseLocation(false) : parseLocation(true),
		requestId: perCallRequestId ?? defaultRequestId,
		scope: perCallScope ?? defaultScope,
		object: cleanObject,
	}
}
