// Layer-agnostic kernel. See ./guards.ts for the kernel's constraints.

/**
 * Parse JSON, throwing a contextual `Error` instead of a bare `SyntaxError`
 * when the input is malformed. `label` is the caller's prefix (a field name, or
 * a richer string like `Invalid IMAGE_REFS "<raw>"`); the thrown message is
 * `<label>: not valid JSON`. Returns the parsed value as `unknown` - callers
 * narrow it themselves (e.g. via `isRecord`).
 */
export function parseJsonOrThrow(raw: string, label: string): unknown {
	try {
		return JSON.parse(raw)
	} catch {
		throw new Error(`${label}: not valid JSON`)
	}
}
