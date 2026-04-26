import { describe, expect, it } from 'vitest'

import { resolveVpsName } from './resolve-vps-name.ts'

describe('resolveVpsName', () => {
	it('returns the override verbatim when set', () => {
		expect(resolveVpsName('custom-host', 'production')).toBe('custom-host')
		expect(resolveVpsName('custom-host', 'development')).toBe('custom-host')
	})

	it('defaults to nn-prod for production when no override', () => {
		expect(resolveVpsName(null, 'production')).toBe('nn-prod')
	})

	it('defaults to nn-dev for development when no override', () => {
		expect(resolveVpsName(null, 'development')).toBe('nn-dev')
	})
})
