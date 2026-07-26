import type { RulesetResource } from './terraform-main-config.ts'

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
