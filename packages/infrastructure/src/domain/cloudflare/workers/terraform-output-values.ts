import { isRecord } from '#/kernel/guards.ts'

// Readers of the raw `terraform output -json` object: each entry is
// `{ value, type, sensitive }`, and a missing entry reads as undefined.

export function extractValue(
	raw: Readonly<Record<string, unknown>>,
	name: string,
): unknown {
	const entry = raw[name]
	if (typeof entry === 'undefined') return undefined
	if (!isRecord(entry) || !('value' in entry)) {
		throw new Error(
			`terraform output "${name}": entry is missing a "value" field`,
		)
	}
	return entry.value
}

export function asString(outputValue: unknown, name: string): string {
	if (typeof outputValue !== 'string') {
		throw new Error(`terraform output "${name}": expected a string value`)
	}
	return outputValue
}

function asStringMap(
	outputValue: unknown,
	name: string,
): Record<string, string> {
	if (!isRecord(outputValue)) {
		throw new Error(`terraform output "${name}": expected an object value`)
	}
	const map: Record<string, string> = {}
	for (const [key, entry] of Object.entries(outputValue)) {
		if (typeof entry !== 'string') {
			throw new Error(
				`terraform output "${name}": entry "${key}" is not a string`,
			)
		}
		map[key] = entry
	}
	return map
}

/**
 * Narrow the raw `terraform output -json` object into the typed outputs. A
 * declared-but-absent output is NOT an error here (the map is simply empty);
 * the "declared service missing its output" check lives in
 * `buildWorkersBackingEnv`, where the config says what MUST be present.
 */
export function optionalStringMap(
	outputValue: unknown,
	name: string,
): Record<string, string> {
	if (typeof outputValue === 'undefined') return {}
	return asStringMap(outputValue, name)
}
