import { describe, expect, it } from 'vitest'

import { resolveDeployDomain } from './deploy-domain.ts'

describe('resolveDeployDomain', () => {
	it('returns domain as-is in production', () => {
		expect(resolveDeployDomain('example.com', 'production')).toBe(
			'example.com',
		)
	})

	it('prefixes dev. in development', () => {
		expect(resolveDeployDomain('example.com', 'development')).toBe(
			'dev.example.com',
		)
	})

	it('prefixes dev. to subdomains', () => {
		expect(resolveDeployDomain('api.example.com', 'development')).toBe(
			'dev.api.example.com',
		)
	})
})
