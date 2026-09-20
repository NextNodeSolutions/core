import { describe, expect, it } from 'vitest'

import { mergeRulesetFamilies } from './terraform-rulesets.ts'

import type { RulesetResource } from './terraform-main-config.ts'

const ruleset = (name: string): RulesetResource => ({
	zone_id: '${data.cloudflare_zone.zone_main.id}',
	name,
	kind: 'zone',
	phase: 'http_request_dynamic_redirect',
	rules: [],
})

describe('mergeRulesetFamilies', () => {
	it('keeps the entries of every family', () => {
		const merged = mergeRulesetFamilies([
			{ redirect_example_fr: ruleset('redirect-example_fr-to-main') },
			{ other_family: ruleset('other-family') },
		])

		expect(Object.keys(merged)).toEqual([
			'redirect_example_fr',
			'other_family',
		])
	})

	it('returns an empty map when every family is empty', () => {
		expect(mergeRulesetFamilies([{}, {}])).toEqual({})
	})

	it('does not mutate the families it merges', () => {
		const redirects = { redirect_example_fr: ruleset('redirect') }
		mergeRulesetFamilies([redirects, { firewall: ruleset('firewall') }])

		expect(Object.keys(redirects)).toEqual(['redirect_example_fr'])
	})
})
