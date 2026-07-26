import { MAIN_ZONE_ID_REF } from './terraform-refs.ts'

import type {
	RulesetPhase,
	RulesetResource,
	RulesetRule,
} from './terraform-main-config.ts'

// The entry point of one phase on the project's own zone. `kind` is "zone":
// "root" is the account-level kind and the API rejects it on a zone-scoped
// ruleset.
export function zoneRuleset(
	name: string,
	phase: RulesetPhase,
	rules: ReadonlyArray<RulesetRule>,
): RulesetResource {
	return { zone_id: MAIN_ZONE_ID_REF, name, kind: 'zone', phase, rules }
}

// Terraform holds every ruleset of the project in ONE `cloudflare_ruleset` map,
// while each family (redirects, rate limiting, firewall) builds its own entries
// under its own label prefix. Assigning a family over that map instead of
// merging into it deletes the other families on the next apply. Pure: no sort,
// no rename, no validation - families own their labels.
export function mergeRulesetFamilies(
	families: ReadonlyArray<Record<string, RulesetResource>>,
): Record<string, RulesetResource> {
	const merged: Record<string, RulesetResource> = {}
	for (const family of families) {
		Object.assign(merged, family)
	}
	return merged
}
