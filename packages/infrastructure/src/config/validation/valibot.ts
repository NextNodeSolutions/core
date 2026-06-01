import {
	array,
	literal,
	never,
	nonEmpty,
	optional,
	pipe,
	safeParse,
	string,
	union,
} from 'valibot'

import type {
	BaseIssue,
	ErrorMessage,
	GenericSchema,
	InferOutput,
	UnionIssue,
} from 'valibot'
import type { ValidationResult } from './result.ts'

// Bridge between a Valibot schema and the config layer's ValidationResult
// contract, plus the shared field vocabulary every config schema reuses.
// Individual validators still import Valibot's schema builders directly (that
// is where schemas are declared); this module owns the two things worth
// centralizing — the `safeParse → ValidationResult` seam and the reusable field
// shapes below.
//
// Every validation action in a config schema MUST carry an explicit message:
// those messages are the user-facing nextnode.toml error strings, surfaced
// verbatim. `abortEarly`/`abortPipeEarly` are off so one parse collects every
// issue (matching the accumulate-all-errors behavior the hand-rolled
// validators had), and issues come back in schema-declaration order.
export function runSchema<TSchema extends GenericSchema>(
	schema: TSchema,
	raw: unknown,
): ValidationResult<InferOutput<TSchema>> {
	const result = safeParse(schema, raw, {
		abortEarly: false,
		abortPipeEarly: false,
	})
	if (result.success) return { ok: true, section: result.output }
	return { ok: false, errors: result.issues.map(issue => issue.message) }
}

// Flatten a set of per-field results into their combined error messages (empty
// when all succeeded). The companion to the per-field `runSchema` pattern used
// where a required scalar needs its own message: validate each value directly,
// then gather. See validateProjectSection / validatePostgresService.
export const collectFieldErrors = (
	...results: ReadonlyArray<ValidationResult<unknown>>
): string[] => results.flatMap(result => (result.ok ? [] : result.errors))

// --- shared field builders ----------------------------------------------
//
// The vocabulary every config schema reuses. Each takes the exact error
// `msg` it surfaces, since messages are the tested contract.

// A required non-empty string (else `msg`).
export const nonEmptyString = (msg: string): GenericSchema<unknown, string> =>
	pipe(string(msg), nonEmpty(msg))

// An optional non-empty string field: absent → undefined, present → must be a
// non-empty string (else `msg`).
export const optionalNonEmpty = (
	msg: string,
): GenericSchema<unknown, string | undefined> => optional(nonEmptyString(msg))

// An optional array-of-non-empty-strings field, defaulting to []. Takes a
// distinct message per failure level — `notArrayMsg` when the value is not an
// array, `entryMsg` when an entry is empty or non-string — so the two cases
// surface separately instead of collapsing into one ambiguous string.
export const stringArray = (
	notArrayMsg: string,
	entryMsg: string,
): GenericSchema<unknown, string[]> =>
	optional(array(nonEmptyString(entryMsg), notArrayMsg), [])

// An optional `string | false` field with a fallback, surfacing `msg` on any
// other type. The shape behind every "set to a command or `false` to disable"
// option.
export const optionalStringOrFalse = (
	msg: ErrorMessage<UnionIssue<BaseIssue<unknown>>>,
	fallback: string | false,
): GenericSchema<unknown, string | false> =>
	optional(union([string(), literal(false)], msg), fallback)

// A field only valid when absent: a present value surfaces `msg`. (Presence is
// enforced at the OBJECT level with a `check`, since an `optional` entry skips
// its own schema when the key is missing — see the per-section validators.)
export const forbiddenField = (
	msg: string,
): GenericSchema<unknown, undefined> => optional(never(msg))
