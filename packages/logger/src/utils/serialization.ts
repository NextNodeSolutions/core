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
	return undefined
}

/**
 * Creates a JSON.stringify replacer for the values JSON cannot represent: a
 * bigint becomes its decimal string, and an object nested inside itself becomes
 * the circular reference marker. It tracks the path from the root to the
 * current value, so an object shared by two branches is serialized in both.
 * Each JSON.stringify call needs its own replacer.
 */
const createJsonSafeReplacer = (): JsonReplacer => {
	const ancestors: object[] = []

	return function replaceUnserializable(_key, fieldValue) {
		if (typeof fieldValue === 'bigint') return fieldValue.toString()
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

/**
 * Serializes a value as JSON. A bigint or a cycle never makes it throw, so
 * every JSON output of the logger goes through it.
 */
export const stringifyJson = (subject: unknown, indent?: number): string =>
	JSON.stringify(subject, createJsonSafeReplacer(), indent)

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : 'Unknown error'

/**
 * The marker that takes the place of a value that cannot be serialized. It
 * names the error, so the output says what went wrong.
 */
const describeSerializationError = (error: unknown): string =>
	`[Serialization Error: ${errorMessage(error)}]`

type Fields = Readonly<Record<string, unknown>>

interface ReplacedFields {
	readonly fields: Fields
	/** One `key (error message)` per field replaced by its marker */
	readonly failures: readonly string[]
}

/**
 * Copies an object's own enumerable fields, replacing each one whose getter or
 * JSON serialization throws by the marker of its error.
 */
const replaceUnserializableFields = (subject: object): ReplacedFields => {
	const failures: string[] = []
	// Object.fromEntries defines own keys, so a `__proto__` key stays a field
	const fields = Object.fromEntries(
		Object.keys(subject).map(key => {
			try {
				const fieldValue: unknown = Reflect.get(subject, key)
				stringifyJson(fieldValue)
				return [key, fieldValue]
			} catch (error) {
				failures.push(`${key} (${errorMessage(error)})`)
				return [key, describeSerializationError(error)]
			}
		}),
	)
	return { fields, failures }
}

export interface SerializedJson {
	readonly json: string
	/** The fields replaced by their marker, empty when nothing failed */
	readonly failures: readonly string[]
}

/**
 * Serializes the shape `buildShape` makes from an entry's object fields. When
 * that throws, each field that cannot be serialized is replaced by its marker
 * and the shape is serialized again.
 */
export const stringifyWithFieldFallback = (
	fields: Fields | undefined,
	buildShape: (fields: Fields | undefined) => unknown,
	indent?: number,
): SerializedJson => {
	try {
		return { json: stringifyJson(buildShape(fields), indent), failures: [] }
	} catch (error) {
		if (!fields) throw error

		// Business rule: a field whose getter or toJSON method throws must not
		// cost the rest of the entry. Only that field becomes a marker, and the
		// caller reports the failures once, with the `[logger]` prefix.
		const replaced = replaceUnserializableFields(fields)
		return {
			json: stringifyJson(buildShape(replaced.fields), indent),
			failures: replaced.failures,
		}
	}
}

export const safeStringify = (subject: unknown): string => {
	try {
		// Fast path for primitives
		const primitiveString = typeToString(subject)
		if (typeof primitiveString !== 'undefined') return primitiveString

		// Direct string conversion for simple types
		if (typeof subject === 'string') return subject
		if (
			typeof subject === 'number' ||
			typeof subject === 'boolean' ||
			typeof subject === 'bigint'
		) {
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
		return describeSerializationError(error)
	}
}
