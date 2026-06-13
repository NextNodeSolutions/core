import { describe, expect, it } from 'vitest'

import { VLOGS_RECORDING_RULE_GROUP } from './alert-rules-self.ts'
import { HTTP_RULE_GROUP } from './alert-rules-service.ts'

/**
 * The HTTP alert chain depends on a VictoriaMetrics-specific behaviour: the
 * vlogs recording rules group by the dotted LogsQL field `request.host`, and
 * the HTTP alerts `label_replace` that SAME dotted label into a clean `host`.
 * A dotted label name is invalid in stock Prometheus; only VM preserves it
 * end to end. If a future VM bump (or a well-meaning rename) normalises
 * `request.host` to `request_host` on ONE side only, the join silently
 * produces no `host` label and every HTTP alert stops resolving its
 * annotations - with no other test failing. These assertions pin both sides
 * to the same dotted name so the contract cannot drift unnoticed.
 */
const DOTTED_HOST_LABEL = 'request.host'

const labelReplaceSources = (expr: string): string[] =>
	[...expr.matchAll(/label_replace\([^,]+,\s*"[^"]+",\s*"[^"]+",\s*"([^"]+)"/g)].map(
		match => match[1] ?? '',
	)

const statsByFields = (expr: string): string[] =>
	[...expr.matchAll(/stats by \(([^)]+)\)/g)].map(match =>
		(match[1] ?? '').trim(),
	)

describe('HTTP alert / vlogs recording contract', () => {
	it('every HTTP alert label_replace reads the dotted request.host label', () => {
		const sources = HTTP_RULE_GROUP.rules.flatMap(rule =>
			labelReplaceSources(rule.expr),
		)

		expect(sources.length).toBeGreaterThan(0)
		for (const source of sources) {
			expect(source).toBe(DOTTED_HOST_LABEL)
		}
	})

	it('pins the dotted request.host label on both the producing and consuming side', () => {
		const produced = new Set(
			VLOGS_RECORDING_RULE_GROUP.rules.flatMap(rule =>
				statsByFields(rule.expr),
			),
		)
		const consumed = new Set(
			HTTP_RULE_GROUP.rules.flatMap(rule => labelReplaceSources(rule.expr)),
		)

		// The alerts consume exactly the one dotted source label...
		expect([...consumed]).toEqual([DOTTED_HOST_LABEL])
		// ...and the recording rules actually produce it. Normalising
		// request.host -> request_host on EITHER side trips one of these.
		expect(produced.has(DOTTED_HOST_LABEL)).toBe(true)
	})
})
