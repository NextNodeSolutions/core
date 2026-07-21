import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	STATIC_NO_DOMAIN,
	STATIC_WITH_DOMAIN,
	WORKERS_APP_WITH_DOMAIN,
} from '#/cli/fixtures.ts'
import { methodOf, notFound, okJson, urlOf } from '#/test-fetch.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { provisionCommand } from './provision.command.ts'

import type { DeployableConfig } from '#/config/types.ts'
import type { FetchImpl } from '#/test-fetch.ts'

const {
	mockEnsureInfra,
	mockEnsureGenerated,
	mockWorkersEnsureInfra,
	mockWorkersLoadBacking,
} = vi.hoisted(() => ({
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
	mockEnsureGenerated: vi.fn(async () => {}),
	mockWorkersEnsureInfra: vi.fn(async () => ({
		kind: 'workers' as const,
		outcome: {
			'hcp-workspace': {
				handled: true,
				detail: 'created "my-worker-production"',
			},
			terraform: { handled: true, detail: 'applied' },
		},
		workspaceName: 'my-worker-production',
		durationMs: 0,
	})),
	mockWorkersLoadBacking: vi.fn(async () => ({ public: {}, secret: {} })),
}))

// Mock the gh-backed generator: provision should DELEGATE to it; the unit under
// test is the wiring (right args, right ordering), not the gh push itself.
vi.mock('./ensure-generated-secrets.ts', () => ({
	ensureGeneratedSecrets: mockEnsureGenerated,
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

vi.mock('../../adapters/cloudflare/workers/target.ts', () => ({
	CloudflareWorkersTarget: vi.fn(() => ({
		name: 'cloudflare-workers',
		contributeEnv: () => ({
			public: { SITE_URL: 'https://example.com' },
			secret: {},
		}),
		ensureInfra: mockWorkersEnsureInfra,
		loadBackingEnv: mockWorkersLoadBacking,
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
		mockEnsureGenerated.mockClear()
		mockWorkersEnsureInfra.mockClear()
		mockWorkersLoadBacking.mockClear()
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		summaryFile = join(tmpdir(), `gh-summary-${id}.txt`)
		outputFile = join(tmpdir(), `gh-output-${id}.txt`)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('GITHUB_REPOSITORY', 'NextNodeSolutions/core')
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

	it('delegates declared generated secrets to ensureGeneratedSecrets', async () => {
		stubCloudflareApi()
		const config: DeployableConfig = {
			...STATIC_WITH_DOMAIN,
			deploy: {
				target: 'cloudflare-pages',
				secrets: [],
				generatedSecrets: [
					{ name: 'JWT_SECRET', generate: 'token', length: 32 },
				],
				vps: null,
				volumes: [],
			},
		}

		await provisionCommand(config)

		expect(mockEnsureGenerated).toHaveBeenCalledWith(
			[{ name: 'JWT_SECRET', generate: 'token', length: 32 }],
			{},
			{
				owner: 'NextNodeSolutions',
				repo: 'core',
				environment: 'production',
			},
		)
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

	it('runs ensureInfra and verifies backing env for a workers project', async () => {
		vi.stubEnv('TF_TOKEN_app_terraform_io', 'tf-token')

		await provisionCommand(WORKERS_APP_WITH_DOMAIN)

		expect(mockWorkersEnsureInfra).toHaveBeenCalledWith('my-worker')
		expect(mockWorkersLoadBacking).toHaveBeenCalledWith('my-worker')

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain('Infrastructure ready for `my-worker`')
		expect(summary).toContain('cloudflare-workers')
		expect(summary).toContain('applied')
	})

	it('builds no R2 CLI service for a workers project declaring [services.r2] - the target Terraform apply realises the buckets', async () => {
		vi.stubEnv('TF_TOKEN_app_terraform_io', 'tf-token')
		// Any R2 CLI service would provision buckets through this fetch; the
		// workers target is fully mocked, so a call here proves double
		// realisation. It must never fire.
		const fetchMock = vi.fn<FetchImpl>(() => {
			throw new Error(
				'unexpected R2 API call: R2 is realised by Terraform',
			)
		})
		vi.stubGlobal('fetch', fetchMock)

		const config: DeployableConfig = {
			...WORKERS_APP_WITH_DOMAIN,
			services: { r2: { buckets: [{ name: 'uploads', cdn: false }] } },
		}

		await provisionCommand(config)

		expect(fetchMock).not.toHaveBeenCalled()
		expect(mockWorkersEnsureInfra).toHaveBeenCalledWith('my-worker')
	})

	it('delegates generated secrets for a workers project', async () => {
		vi.stubEnv('TF_TOKEN_app_terraform_io', 'tf-token')

		await provisionCommand(WORKERS_APP_WITH_DOMAIN)

		expect(mockEnsureGenerated).toHaveBeenCalledWith(
			[],
			{},
			{
				owner: 'NextNodeSolutions',
				repo: 'core',
				environment: 'production',
			},
		)
	})
})
