/**
 * Pure log entry builder.
 * Shared between the production logger and the spy logger used in tests.
 */

import { parseLocation } from '../utils/location.js'
import { extractScope } from '../utils/scope.js'
import { getCurrentTimestamp } from '../utils/time.js'

import type { LogEntry, LogLevel, LogObject } from '../types.js'
import type { StackEntryPoint } from '../utils/location.js'

export interface CreateLogEntryOptions {
	readonly level: LogLevel
	readonly message: string
	readonly object?: LogObject | undefined
	readonly defaultRequestId: string
	readonly defaultScope?: string | undefined
	readonly prefix?: string | undefined
	readonly includeLocation?: boolean | undefined
	/**
	 * The level method the caller invoked. The location is the code that
	 * called it.
	 */
	readonly entryPoint: StackEntryPoint
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
		entryPoint,
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
		location: parseLocation(!includeLocation, entryPoint),
		requestId: perCallRequestId ?? defaultRequestId,
		scope: perCallScope ?? defaultScope,
		object: cleanObject,
	}
}
