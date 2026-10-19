/**
 * Scope extraction utility for NextNode Logger
 * Separates scope from other log object properties
 */

import { replaceUnserializableFields } from './serialization.js'

import type { LogObject } from '../types.js'

interface ExtractedScope {
	scope: string | undefined
	requestId: string | undefined
	cleanObject: Omit<LogObject, 'scope' | 'requestId'> | undefined
}

const splitScope = (object: LogObject): ExtractedScope => {
	const { scope, requestId, ...rest } = object
	const hasOtherProperties = Object.keys(rest).length > 0

	return {
		scope,
		requestId,
		cleanObject: hasOtherProperties ? rest : undefined,
	}
}

/**
 * Extracts scope from a log object and returns it separately from other properties.
 * Used by logger to handle scope-based organization.
 */
export const extractScope = (object?: LogObject): ExtractedScope => {
	if (!object) {
		return {
			scope: undefined,
			requestId: undefined,
			cleanObject: undefined,
		}
	}

	try {
		return splitScope(object)
	} catch {
		// Business rule: a log call never throws into the caller. A field whose
		// getter throws becomes a marker that names the error, as in JSON output,
		// the rest of the entry is kept, and the replaced fields are reported once.
		const { fields, failures } = replaceUnserializableFields(object)
		console.error(
			`[logger] log call replaced fields it cannot read or serialize: ${failures.join(', ')}`,
		)
		return splitScope(fields)
	}
}
