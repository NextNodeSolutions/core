import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STATIC_NO_DOMAIN, STATIC_WITH_DOMAIN } from '../fixtures.ts'

import { dnsCommand } from './dns.command.ts'

interface MockResponse {
	ok: boolean
	status: number
	json: () => Promise<unknown>
	text: () => Promise<string>
}

type FetchInput = string | URL
type FetchImpl = (
	input: FetchInput,
	init?: RequestInit,
) => Promise<MockResponse>

function okJson(body: unknown): MockResponse {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	}
}

function urlOf(input: FetchInput): string {
	return typeof input === 'string' ? input : input.toString()
}

function methodOf(init: RequestInit | undefined): string {
	return init?.method ?? 'GET'
}

function stubCloudflareApi(): ReturnType<typeof vi.fn<FetchImpl>> {
	const impl: FetchImpl = (input, init) => {
		const url = urlOf(input)
		const method = methodOf(init)

		if (url.includes('/zones?name=') && method === 'GET') {
			return Promise.resolve(
				okJson({
					success: true,
					result: [{ id: 'zone-1', name: 'example.com' }],
					errors: [],
				}),
			)
		}
		if (url.includes('/dns_records') && method === 'GET') {
			return Promise.resolve(
				okJson({ success: true, result: [], errors: [] }),
			)
		}
		if (url.includes('/dns_records') && method === 'POST') {
			return Promise.resolve(
				okJson({
					success: true,
					result: {
						id: 'rec-1',
						type: 'CNAME',
						name: 'example.com',
						content: 'my-site.pages.dev',
						proxied: true,
						ttl: 1,
					},
					errors: [],
				}),
			)
		}

		throw new Error(`Unexpected call: ${method} ${url}`)
	}

	const fetchMock = vi.fn<FetchImpl>(impl)
	vi.stubGlobal('fetch', fetchMock)
	return fetchMock
}

describe('dnsCommand', () => {
	beforeEach(() => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('creates DNS records for a static project with domain', async () => {
		const fetchMock = stubCloudflareApi()

		await dnsCommand(STATIC_WITH_DOMAIN)

		const postCalls = fetchMock.mock.calls.filter(
			call => methodOf(call[1]) === 'POST',
		)
		expect(postCalls.length).toBeGreaterThan(0)
	})

	it('skips when no domain configured', async () => {
		const fetchMock = vi.fn<FetchImpl>()
		vi.stubGlobal('fetch', fetchMock)

		await dnsCommand(STATIC_NO_DOMAIN)

		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('throws when CLOUDFLARE_API_TOKEN is missing', async () => {
		vi.stubEnv('CLOUDFLARE_API_TOKEN', undefined)

		await expect(dnsCommand(STATIC_WITH_DOMAIN)).rejects.toThrow(
			'CLOUDFLARE_API_TOKEN env var',
		)
	})
})
