import { describe, expect, it } from 'vitest'

import {
	computeR2CustomDomainHostname,
	computeR2PublicUrl,
} from './custom-domain.ts'

describe('computeR2CustomDomainHostname', () => {
	it('groups the bucket under a cdn subdomain of the apex in production', () => {
		expect(
			computeR2CustomDomainHostname(
				'uploads',
				'example.com',
				'production',
			),
		).toBe('uploads.cdn.example.com')
	})

	it('prefixes the dev subdomain for the development environment', () => {
		expect(
			computeR2CustomDomainHostname(
				'uploads',
				'example.com',
				'development',
			),
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
