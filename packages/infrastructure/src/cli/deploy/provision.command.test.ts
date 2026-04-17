import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STATIC_NO_DOMAIN, STATIC_WITH_DOMAIN } from '../fixtures.ts'

import { provisionCommand } from './provision.command.ts'

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

function notFound(): MockResponse {
	return {
		ok: false,
		status: 404,
		json: () => Promise.resolve({}),
		text: () => Promise.resolve('Not found'),
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

		if (url.includes('/domains') && method === 'GET') {
			return Promise.resolve(
				okJson({ success: true, result: [], errors: [] }),
			)
		}
		if (url.includes('/domains') && method === 'POST') {
			return Promise.resolve(
				okJson({
					success: true,
					result: { name: 'x', status: 'initializing' },
					errors: [],
				}),
			)
		}
		if (url.includes('/pages/projects/') && method === 'GET') {
			return Promise.resolve(notFound())
		}
		if (url.includes('/pages/projects') && method === 'POST') {
			return Promise.resolve(
				okJson({
					success: true,
					result: {
						name: 'my-site',
						production_branch: 'main',
						subdomain: 'my-site.pages.dev',
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

describe('provisionCommand', () => {
	let summaryFile: string

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		summaryFile = join(tmpdir(), `gh-summary-${id}.txt`)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile)
	})

	afterEach(() => {
		rmSync(summaryFile, { force: true })
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('provisions Pages project and domains for a static project with domain', async () => {
		const fetchMock = stubCloudflareApi()

		await provisionCommand(STATIC_WITH_DOMAIN)

		const urls = fetchMock.mock.calls.map(call => urlOf(call[0]))
		expect(urls.some(u => u.includes('/pages/projects'))).toBe(true)
		expect(urls.some(u => u.includes('/domains'))).toBe(true)
	})

	it('provisions only the Pages project when no domain configured', async () => {
		const fetchMock = stubCloudflareApi()

		await provisionCommand(STATIC_NO_DOMAIN)

		const urls = fetchMock.mock.calls.map(call => urlOf(call[0]))
		expect(urls.some(u => u.includes('/pages/projects'))).toBe(true)
		expect(urls.some(u => u.includes('/dns_records'))).toBe(false)
	})

	it('writes provision summary to GITHUB_STEP_SUMMARY', async () => {
		stubCloudflareApi()

		await provisionCommand(STATIC_WITH_DOMAIN)

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain('Infrastructure ready for `my-site`')
		expect(summary).toContain('cloudflare-pages')
	})

	it('throws when CLOUDFLARE_ACCOUNT_ID is missing', async () => {
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', undefined)

		await expect(provisionCommand(STATIC_NO_DOMAIN)).rejects.toThrow(
			'CLOUDFLARE_ACCOUNT_ID env var',
		)
	})

	it('throws when CLOUDFLARE_API_TOKEN is missing', async () => {
		vi.stubEnv('CLOUDFLARE_API_TOKEN', undefined)

		await expect(provisionCommand(STATIC_NO_DOMAIN)).rejects.toThrow(
			'CLOUDFLARE_API_TOKEN env var',
		)
	})
})
