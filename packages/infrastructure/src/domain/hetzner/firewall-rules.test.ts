import { describe, expect, it } from 'vitest'

import { computeFirewallRules } from './firewall-rules.ts'

describe('computeFirewallRules', () => {
	it('returns HTTP, HTTPS, and SSH rules for public mode', () => {
		const rules = computeFirewallRules(false)

		expect(rules).toHaveLength(3)
		expect(rules.map(r => r.description)).toEqual(['HTTP', 'HTTPS', 'SSH'])
	})

	it('returns only SSH rule for internal mode', () => {
		const rules = computeFirewallRules(true)

		expect(rules).toHaveLength(1)
		expect(rules[0]!.description).toBe('SSH')
		expect(rules[0]!.port).toBe('22')
	})

	it('opens all sources for every rule', () => {
		for (const internal of [true, false]) {
			for (const rule of computeFirewallRules(internal)) {
				expect(rule.source_ips).toEqual(['0.0.0.0/0', '::/0'])
				expect(rule.direction).toBe('in')
				expect(rule.protocol).toBe('tcp')
			}
		}
	})
})
