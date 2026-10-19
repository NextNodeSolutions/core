/**
 * JSON formatter for NextNode Logger
 * Produces structured JSON output for production/log aggregation systems
 */

import { stringifyWithFieldFallback } from '../utils/serialization.js'

import type { LogEntry } from '../types.js'
import type { SerializedJson } from '../utils/serialization.js'

/**
 * Keys that are filtered out during object flattening to prevent
 * prototype pollution attacks.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const BASE_KEYS: ReadonlySet<string> = new Set([
	'level',
	'message',
	'timestamp',
	'location',
	'requestId',
	'scope',
])

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
/**
 * Returns a log object's safe properties, skipping undefined values and
 * prototype-pollution-prone keys, ready to be flattened onto the output.
 */
const safeObjectEntries = (
	object: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
	const safe: Record<string, unknown> = {}
	for (const [key, fieldValue] of Object.entries(object)) {
		if (typeof fieldValue === 'undefined' || DANGEROUS_KEYS.has(key))
			continue
		safe[key] = fieldValue
	}
	return safe
}

const buildJsonOutput = (
	entry: LogEntry,
	object: Readonly<Record<string, unknown>> | undefined,
): JsonLogOutput => {
	const { level, message, timestamp, location, requestId, scope } = entry

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
		for (const [key, fieldValue] of Object.entries(
			safeObjectEntries(object),
		)) {
			// A key named like a base field must not replace it, so log stores
			// keep querying the real level, message, time and location.
			output[BASE_KEYS.has(key) ? `object.${key}` : key] = fieldValue
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
	formatJsonLine(entry).json

/**
 * Formats a log entry as pretty-printed JSON.
 * Useful for debugging and development with structured output.
 */
export const formatAsJsonPretty = (entry: LogEntry): string =>
	formatJsonLine(entry, 2).json

/**
 * Formats a log entry as JSON and lists the fields of its object that were
 * replaced by a marker because they cannot be serialized.
 */
export const formatJsonLine = (
	entry: LogEntry,
	indent?: number,
): SerializedJson =>
	stringifyWithFieldFallback(
		entry.object,
		object => buildJsonOutput(entry, object),
		indent,
	)
