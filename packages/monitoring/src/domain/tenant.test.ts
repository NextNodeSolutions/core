import { describe, expect, it } from 'vitest'

import { isTenantTier, rateLimitForTier, TENANT_TIERS } from './tenant.ts'

describe('tenant tiers', () => {
	it('exposes the full list of tiers', () => {
		expect(TENANT_TIERS).toEqual(['standard', 'enterprise'])
	})

	it.each([
		{ tier: 'standard' as const, expected: 60 },
		{ tier: 'enterprise' as const, expected: 600 },
	])('rateLimitForTier($tier) returns $expected', ({ tier, expected }) => {
		expect(rateLimitForTier(tier)).toBe(expected)
	})

	it.each([
		{ input: 'standard', expected: true },
		{ input: 'enterprise', expected: true },
		{ input: 'premium', expected: false },
		{ input: '', expected: false },
		{ input: 123, expected: false },
		{ input: null, expected: false },
		{ input: undefined, expected: false },
	])('isTenantTier($input) returns $expected', ({ input, expected }) => {
		expect(isTenantTier(input)).toBe(expected)
	})
})
