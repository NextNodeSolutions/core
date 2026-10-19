import { safeParse } from 'valibot'

import type { GenericSchema } from 'valibot'

// `--json` output starts on the first line opening an array: anything pnpm or
// wrangler prints before it is skipped.
const JSON_ARRAY_START = /^\[/m

function unexpectedOutput(label: string, stdout: string): Error {
	return new Error(`wrangler ${label}: unexpected output:\n${stdout}`)
}

function readJson(text: string, label: string): unknown {
	try {
		return JSON.parse(text)
	} catch (error) {
		throw new Error(`wrangler ${label}: output is not JSON:\n${text}`, {
			cause: error,
		})
	}
}

/**
 * Read the JSON array a `wrangler ... --json` command prints, checked against
 * `schema`. Output that is not that array throws with the raw text, so a
 * format change in wrangler fails loudly instead of reading as empty.
 */
export function parseWranglerJsonArray<T>(
	stdout: string,
	schema: GenericSchema<unknown, T>,
	label: string,
): T {
	const start = stdout.search(JSON_ARRAY_START)
	if (start === -1) throw unexpectedOutput(label, stdout)
	const parsed = safeParse(schema, readJson(stdout.slice(start), label))
	if (!parsed.success) throw unexpectedOutput(label, stdout)
	return parsed.output
}
