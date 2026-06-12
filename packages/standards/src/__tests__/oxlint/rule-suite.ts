import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { fixtureFile, lintFixtures } from './harness'

import type { LintRun, RuleCase } from './harness'

type SuiteOptions = {
	typeAware?: boolean
}

export const registerRuleSuite = (
	cases: RuleCase[],
	options: SuiteOptions = {},
): void => {
	let run: LintRun

	beforeAll(async () => {
		run = await lintFixtures(cases, { typeAware: options.typeAware })
	}, 120_000)

	afterAll(async () => {
		await run.cleanup()
	})

	describe.each(cases)('$rule', ruleCase => {
		it('functional: flags the violating code', () => {
			const file = fixtureFile(ruleCase, 'bad')
			const matching = run
				.diagnosticsFor(file)
				.filter(d => d.code === ruleCase.rule)

			expect(
				matching.length,
				`expected ${ruleCase.rule} to fire on ${file}`,
			).toBeGreaterThan(0)
			expect(matching[0]?.severity).toBe(ruleCase.severity)
		})

		it(`edge: ${ruleCase.edgeExpect === 'fire' ? 'still flags the tricky variant' : 'tolerates the allowed variant'}`, () => {
			const file = fixtureFile(ruleCase, 'edge')
			const codes = run.codesFor(file)

			if (ruleCase.edgeExpect === 'fire') {
				expect(
					codes,
					`expected ${ruleCase.rule} to fire on ${file}`,
				).toContain(ruleCase.rule)
				return
			}
			expect(
				codes,
				`expected ${ruleCase.rule} NOT to fire on ${file}`,
			).not.toContain(ruleCase.rule)
		})

		it('non-regression: compliant code passes', () => {
			const file = fixtureFile(ruleCase, 'good')
			expect(
				run.codesFor(file),
				`expected ${ruleCase.rule} NOT to fire on ${file}`,
			).not.toContain(ruleCase.rule)
		})
	})
}
