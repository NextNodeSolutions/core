import {
	buildHostExpression,
	buildPathsExpression,
} from './ruleset-expressions.ts'
import { toTerraformLabel } from './terraform-labels.ts'
import { zoneRuleset } from './terraform-rulesets.ts'

import type { WorkerRateLimitConfig } from '#/config/worker-firewall.ts'
import type { RulesetResource } from './terraform-main-config.ts'

// What the counter is keyed by. `ip.src` is the only characteristic the Free
// plan offers, and `cf.colo.id` is MANDATORY in the characteristics (the rule
// counts per data centre) while being FORBIDDEN in the expression.
const RATE_LIMIT_CHARACTERISTICS = ['ip.src', 'cf.colo.id'] as const

const TOO_MANY_REQUESTS_STATUS = 429

const RATE_LIMITED_BODY = JSON.stringify({ error: 'rate_limited' })

export interface WorkerRateLimitRule {
	readonly serviceName: string
	readonly host: string
	readonly rateLimit: WorkerRateLimitConfig
}

function buildExpression(rule: WorkerRateLimitRule): string {
	const { paths, methods } = rule.rateLimit
	const clauses = [
		buildHostExpression(rule.host),
		`(${buildPathsExpression(paths)})`,
		...(methods?.length
			? [
					`http.request.method in {${methods.map(method => `"${method}"`).join(' ')}}`,
				]
			: []),
	]
	return `(${clauses.join(' and ')})`
}

function rateLimitRuleset(
	rule: WorkerRateLimitRule,
	label: string,
): RulesetResource {
	const { requestsPerPeriod, period, mitigationTimeout } = rule.rateLimit
	return zoneRuleset(`ratelimit-${label}`, 'http_ratelimit', [
		{
			ref: `ratelimit_${label}`,
			description: `Rate limit ${rule.host} to ${requestsPerPeriod} requests per ${period} seconds`,
			expression: buildExpression(rule),
			action: 'block',
			action_parameters: {
				response: {
					status_code: TOO_MANY_REQUESTS_STATUS,
					content_type: 'application/json',
					content: RATE_LIMITED_BODY,
				},
			},
			ratelimit: {
				characteristics: [...RATE_LIMIT_CHARACTERISTICS],
				period,
				requests_per_period: requestsPerPeriod,
				mitigation_timeout: mitigationTimeout,
			},
		},
	])
}

export function buildRateLimitResources(
	rules: ReadonlyArray<WorkerRateLimitRule>,
): Record<string, RulesetResource> {
	const rulesets: Record<string, RulesetResource> = {}
	for (const rule of rules) {
		const label = toTerraformLabel(rule.serviceName)
		rulesets[`ratelimit_${label}`] = rateLimitRuleset(rule, label)
	}
	return rulesets
}
