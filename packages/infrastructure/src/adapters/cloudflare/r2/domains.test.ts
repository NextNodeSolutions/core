import { httpError, lastBody, lastCall, okJson } from '#/test-fetch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	deleteR2CustomDomain,
	ensureR2CustomDomain,
	getR2CustomDomainStatus,
	listR2CustomDomains,
} from './domains.ts'

import type { MockResponse } from '#/test-fetch.ts'

const BUCKET = 'myapp-production-assets'
const DOMAIN = 'assets.cdn.example.com'
const BASE = `https://api.cloudflare.com/client/v4/accounts/acct/r2/buckets/${BUCKET}/domains/custom`

afterEach(() => {
	vi.unstubAllGlobals()
})

function domainsList(domains: ReadonlyArray<string>): MockResponse {
	return okJson({
		success: true,
		result: { domains: domains.map(domain => ({ domain, enabled: true })) },
		errors: [],
	})
}

describe('listR2CustomDomains', () => {
	it('returns the attached domain names', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(domainsList([DOMAIN])))
		expect(await listR2CustomDomains('tok', 'acct', BUCKET)).toEqual([
			DOMAIN,
		])
	})

	it('returns an empty list when no custom domains are attached', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(domainsList([])))
		expect(await listR2CustomDomains('tok', 'acct', BUCKET)).toEqual([])
	})
})

describe('ensureR2CustomDomain', () => {
	const INPUT = {
		token: 'tok',
		accountId: 'acct',
		bucketName: BUCKET,
		domain: DOMAIN,
		zoneId: 'zone-1',
	}

	it('returns false without attaching when the domain is already present', async () => {
		const fetchMock = vi.fn().mockResolvedValue(domainsList([DOMAIN]))
		vi.stubGlobal('fetch', fetchMock)

		expect(await ensureR2CustomDomain(INPUT)).toBe(false)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('attaches the domain with zoneId + enabled and returns true when absent', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(domainsList([]))
			.mockResolvedValueOnce(
				okJson({
					success: true,
					result: { domain: DOMAIN },
					errors: [],
				}),
			)
		vi.stubGlobal('fetch', fetchMock)

		expect(await ensureR2CustomDomain(INPUT)).toBe(true)
		expect(fetchMock).toHaveBeenCalledTimes(2)
		const [url, init] = lastCall(fetchMock)
		expect(url).toBe(BASE)
		expect(init.method).toBe('POST')
		expect(lastBody(fetchMock)).toEqual({
			domain: DOMAIN,
			zoneId: 'zone-1',
			enabled: true,
		})
	})

	it('throws when the attach request fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(domainsList([]))
				.mockResolvedValueOnce(httpError(403, 'denied')),
		)
		await expect(ensureR2CustomDomain(INPUT)).rejects.toThrow(
			'Cloudflare API returned 403',
		)
	})
})

describe('getR2CustomDomainStatus', () => {
	it('returns the ownership + ssl status', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: true,
					result: {
						domain: DOMAIN,
						status: { ownership: 'active', ssl: 'active' },
					},
					errors: [],
				}),
			),
		)
		expect(
			await getR2CustomDomainStatus('tok', 'acct', BUCKET, DOMAIN),
		).toEqual({ ownership: 'active', ssl: 'active' })
	})

	it('throws when the status object is missing', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: true,
					result: { domain: DOMAIN },
					errors: [],
				}),
			),
		)
		await expect(
			getR2CustomDomainStatus('tok', 'acct', BUCKET, DOMAIN),
		).rejects.toThrow('status')
	})
})

describe('deleteR2CustomDomain', () => {
	it('issues a DELETE for the domain', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			okJson({
				success: true,
				result: { domain: DOMAIN },
				errors: [],
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		await deleteR2CustomDomain('tok', 'acct', BUCKET, DOMAIN)

		const [url, init] = lastCall(fetchMock)
		expect(url).toBe(`${BASE}/${DOMAIN}`)
		expect(init.method).toBe('DELETE')
	})
})
