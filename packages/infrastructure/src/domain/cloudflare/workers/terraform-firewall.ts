import {
	buildHostExpression,
	buildPathsExpression,
} from './ruleset-expressions.ts'
import { toTerraformLabel } from './terraform-labels.ts'
import { zoneRuleset } from './terraform-rulesets.ts'

import type {
	BlockRulesetRule,
	RulesetResource,
} from './terraform-main-config.ts'

// One Terraform label for the whole family: a zone owns a single entry point
// for the firewall phase, so every worker's rule lives in this one resource.
const FIREWALL_LABEL = 'firewall_public_paths'

export interface WorkerPublicPathsRule {
	readonly serviceName: string
	readonly host: string
	readonly publicPaths: ReadonlyArray<string>
}

// The rule blocks the NEGATION of what is open: everything on the host that is
// not one of the declared paths. An empty `publicPaths` therefore blocks the
// host outright.
function buildExpression(rule: WorkerPublicPathsRule): string {
	const host = buildHostExpression(rule.host)
	if (!rule.publicPaths.length) return `(${host})`
	return `(${host} and not (${buildPathsExpression(rule.publicPaths)}))`
}

function buildDescription(rule: WorkerPublicPathsRule): string {
	if (!rule.publicPaths.length) return `Block every path of ${rule.host}`
	return `Block every path of ${rule.host} but ${rule.publicPaths.join(', ')}`
}

function publicPathsRule(rule: WorkerPublicPathsRule): BlockRulesetRule {
	return {
		ref: `firewall_${toTerraformLabel(rule.serviceName)}`,
		description: buildDescription(rule),
		expression: buildExpression(rule),
		action: 'block',
	}
}

// Rules are ordered by service name: order inside a ruleset is evaluation
// order, and the generated config must be stable run to run.
export function buildFirewallResources(
	rules: ReadonlyArray<WorkerPublicPathsRule>,
): Record<string, RulesetResource> {
	if (!rules.length) return {}
	const ordered = rules.toSorted((left, right) =>
		left.serviceName.localeCompare(right.serviceName),
	)
	return {
		[FIREWALL_LABEL]: zoneRuleset(
			'firewall-public-paths',
			'http_request_firewall_custom',
			ordered.map(publicPathsRule),
		),
	}
}
