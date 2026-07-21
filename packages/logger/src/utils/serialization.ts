/**
 * Serialization utilities for NextNode Logger
 * Zero dependencies, using only Node.js built-in modules
 */

// Centralized string conversion for special types
const typeToString = (subject: unknown): string | undefined => {
	if (subject === null) return 'null'
	if (typeof subject === 'undefined') return 'undefined'
	if (typeof subject === 'function')
		return `[Function: ${subject.name || 'anonymous'}]`
	if (typeof subject === 'symbol') return subject.toString()
	if (typeof subject === 'bigint') return subject.toString()
	return undefined
}

export const safeStringify = (subject: unknown): string => {
	try {
		// Fast path for primitives
		const primitiveString = typeToString(subject)
		if (typeof primitiveString !== 'undefined') return primitiveString

		// Direct string conversion for simple types
		if (typeof subject === 'string') return subject
		if (typeof subject === 'number' || typeof subject === 'boolean') {
			return String(subject)
		}

		// Complex object serialization with circular reference protection
		const seen = new WeakSet<object>()

		const replacer = (_key: string, val: unknown): unknown => {
			// Early return for non-objects
			if (typeof val !== 'object' || val === null) {
				const specialString = typeToString(val)
				return specialString ?? val
			}

			// Circular reference check
			if (seen.has(val)) return '[Circular Reference]'
			seen.add(val)

			return val
		}

		return JSON.stringify(subject, replacer, 2)
	} catch (error) {
		// Business rule: logger internals MUST NOT log through the logger
		// (would recurse through the same serialization path). Embedding
		// the error message in the returned string still surfaces the
		// failure reason in whichever log line triggered serialization.
		return `[Serialization Error: ${error instanceof Error ? error.message : 'Unknown error'}]`
	}
}
