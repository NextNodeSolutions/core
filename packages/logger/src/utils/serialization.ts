/**
 * Serialization utilities for NextNode Logger
 * Uses only JavaScript built-ins, so it runs in every runtime
 */

const CIRCULAR_REFERENCE_MARKER = '[Circular Reference]'

type JsonReplacer = (this: unknown, key: string, value: unknown) => unknown

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

/**
 * Creates a JSON.stringify replacer that turns an object nested inside itself
 * into the circular reference marker. It tracks the path from the root to the
 * current value, so an object shared by two branches is serialized in both.
 * Each JSON.stringify call needs its own replacer.
 */
const createJsonSafeReplacer = (): JsonReplacer => {
	const ancestors: object[] = []

	return function replaceUnserializable(_key, fieldValue) {
		if (typeof fieldValue !== 'object' || fieldValue === null)
			return fieldValue

		// JSON.stringify calls the replacer with the parent object as `this`, so
		// every object stacked above that parent belongs to a finished branch.
		while (ancestors.length > 0 && ancestors.at(-1) !== this)
			ancestors.pop()

		if (ancestors.includes(fieldValue)) return CIRCULAR_REFERENCE_MARKER
		ancestors.push(fieldValue)

		return fieldValue
	}
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

		const replaceUnserializable = createJsonSafeReplacer()

		const replacer: JsonReplacer = function replaceForDisplay(
			key,
			fieldValue,
		) {
			return (
				typeToString(fieldValue) ??
				replaceUnserializable.call(this, key, fieldValue)
			)
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
