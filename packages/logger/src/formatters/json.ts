/**
 * JSON formatter for NextNode Logger
 * Produces structured JSON output for production/log aggregation systems
 */

import type { LogEntry } from '../types.js'

/**
 * Keys that are filtered out during object flattening to prevent
 * prototype pollution attacks.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export interface JsonLogOutput {
	level: string
	message: string
	timestamp: string
	location: {
		function: string
		file?: string
		line?: number
	}
	requestId: string
	scope?: string
	[key: string]: unknown
}

/**
 * Builds the JSON output object from a log entry.
 * - Flattens object properties into root level for easier querying
 * - Filters out dangerous keys to prevent prototype pollution
 */
const buildJsonOutput = (entry: LogEntry): JsonLogOutput => {
	const { level, message, timestamp, location, requestId, scope, object } =
		entry

	const output: JsonLogOutput = {
		level,
		message,
		timestamp,
		location,
		requestId,
	}

	if (scope) {
		output.scope = scope
	}

	if (object) {
		for (const [key, value] of Object.entries(object)) {
			if (value !== undefined && !DANGEROUS_KEYS.has(key)) {
				output[key] = value
			}
		}
	}

	return output
}

/**
 * Formats a log entry as structured JSON.
 * - Omits undefined/null optional fields for cleaner output
 * - Flattens object properties into root level for easier querying
 * - Produces single-line JSON optimized for log aggregation
 */
export const formatAsJson = (entry: LogEntry): string =>
	JSON.stringify(buildJsonOutput(entry))

/**
 * Formats a log entry as pretty-printed JSON.
 * Useful for debugging and development with structured output.
 */
export const formatAsJsonPretty = (entry: LogEntry): string =>
	JSON.stringify(buildJsonOutput(entry), null, 2)
