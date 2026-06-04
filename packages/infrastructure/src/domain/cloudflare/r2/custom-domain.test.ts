import { describe, expect, it } from 'vitest'

import {
	computeR2CustomDomainHostname,
	computeR2PublicUrl,
} from './custom-domain.ts'

describe('computeR2CustomDomainHostname', () => {
	it('groups the bucket under a cdn subdomain of the resolved apex', () => {
		expect(computeR2CustomDomainHostname('uploads', 'example.com')).toBe(
			'uploads.cdn.example.com',
		)
	})

	it('does NOT re-resolve an already dev-resolved domain (no double dev. prefix)', () => {
		// `dev.example.com` is what `resolveDeployDomain` already produced for a
		// development deploy; this helper must take it verbatim, not prepend a
		// second `dev.`.
		expect(
			computeR2CustomDomainHostname('uploads', 'dev.example.com'),
		).toBe('uploads.cdn.dev.example.com')
	})
})

describe('computeR2PublicUrl', () => {
	it('prepends the https scheme to the hostname', () => {
		expect(computeR2PublicUrl('uploads.cdn.example.com')).toBe(
			'https://uploads.cdn.example.com',
		)
	})
})
