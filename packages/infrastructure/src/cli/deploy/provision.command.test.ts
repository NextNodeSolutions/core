import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { STATIC_NO_DOMAIN, STATIC_WITH_DOMAIN } from '#/cli/fixtures.ts'
import type { FetchImpl } from '#/test-fetch.ts'
import { methodOf, notFound, okJson, urlOf } from '#/test-fetch.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { provisionCommand } from './provision.command.ts'

const { mockEnsureInfra } = vi.hoisted(() => ({
	mockEnsureInfra: vi.fn(async () => ({
		kind: 'vps' as const,
		outcome: {},
		serverId: 1,
		serverType: 'cx23',
		location: 'nbg1',
		publicIp: '203.0.113.10',
		tailnetIp: '100.64.0.1',
		durationMs: 0,
	})),
}))

vi.mock('../../adapters/hetzner/target.ts', () => ({
	HetznerVpsTarget: vi.fn(() => ({
		name: 'hetzner-vps',
		contributeEnv: () => ({ public: {}, secret: {} }),
		deploy: vi.fn(),
		ensureInfra: mockEnsureInfra,
		reconcileDns: vi.fn(),
	})),
}))

vi.mock(import('./load-infra-storage.ts'), async importOriginal => {
	const original = await importOriginal()
	return {
		...original,
		ensureInfraStorageForConfig: vi.fn(async config => {
			if (config.project.type === 'static') return null
			return {
				accountId: 'acct-123',
				endpoint: 'https://acct-123.r2.cloudflarestorage.com',
				accessKeyId: 'fresh-r2-key',
				secretAccessKey: 'fresh-r2-secret',
				stateBucket: 'nextnode-state',
				certsBucket: 'nextnode-certs',
			}
		}),
	}
})

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
	let outputFile: string

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		summaryFile = join(tmpdir(), `gh-summary-${id}.txt`)
		outputFile = join(tmpdir(), `gh-output-${id}.txt`)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile)
		vi.stubEnv('GITHUB_OUTPUT', outputFile)
	})

	afterEach(() => {
		rmSync(summaryFile, { force: true })
		rmSync(outputFile, { force: true })
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
