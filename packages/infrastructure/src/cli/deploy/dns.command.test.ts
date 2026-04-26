import ssh2 from 'ssh2'
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest'

const { utils: sshUtils } = ssh2

import {
	APP_WITH_DOMAIN,
	STATIC_NO_DOMAIN,
	STATIC_WITH_DOMAIN,
} from '#/cli/fixtures.ts'

import { dnsCommand } from './dns.command.ts'

// Mock loadR2Runtime (network boundary: Cloudflare accounts API + SigV4 verify)
vi.mock(import('#/cli/r2/load-runtime.ts'), async () => ({
	loadR2Runtime: vi.fn(async () => ({
		accountId: 'acct',
		endpoint: 'https://r2.example.com',
		accessKeyId: 'r2-key',
		secretAccessKey: 'r2-secret',
		stateBucket: 'nextnode-state',
		certsBucket: 'nextnode-certs',
	})),
}))

// Mock HetznerVpsTarget class (network boundary: SSH, R2, Hetzner Cloud API)
const { mockHetznerReconcileDns } = vi.hoisted(() => ({
	mockHetznerReconcileDns: vi.fn(),
}))
vi.mock('../../adapters/hetzner/target.ts', () => ({
	HetznerVpsTarget: vi.fn(() => ({
		name: 'hetzner-vps',
		reconcileDns: mockHetznerReconcileDns,
		ensureInfra: vi.fn(),
		computeDeployEnv: vi.fn(),
		deploy: vi.fn(),
	})),
}))

import type { FetchImpl } from '#/test-fetch.ts'
import { methodOf, okJson, urlOf } from '#/test-fetch.ts'

function stubCloudflareApi(): ReturnType<typeof vi.fn<FetchImpl>> {
	const impl: FetchImpl = (input, init) => {
		const url = urlOf(input)
		const method = methodOf(init)

		if (url.includes('/pages/projects/') && method === 'GET') {
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
		if (url.includes('/settings/ssl') && method === 'GET') {
			return Promise.resolve(
				okJson({
					success: true,
					result: { id: 'ssl', value: 'strict' },
					errors: [],
				}),
			)
		}
		if (url.includes('/settings/ssl') && method === 'PATCH') {
			return Promise.resolve(
				okJson({
					success: true,
					result: { id: 'ssl', value: 'strict' },
					errors: [],
				}),
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

describe('dnsCommand — hetzner dispatch', () => {
	let testPrivateKey: string

	beforeAll(() => {
		testPrivateKey = sshUtils.generateKeyPairSync('ed25519').private
	})

	beforeEach(() => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('HETZNER_API_TOKEN', 'hcloud-token')
		vi.stubEnv(
			'DEPLOY_SSH_PRIVATE_KEY_B64',
			Buffer.from(testPrivateKey).toString('base64'),
		)
		vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey-auth-test')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
		mockHetznerReconcileDns.mockReset()
	})

	it('dispatches to the Hetzner target (no CF-only guard regression)', async () => {
		mockHetznerReconcileDns.mockResolvedValue(undefined)
		const { loadR2Runtime } = await import('#/cli/r2/load-runtime.ts')
		const { HetznerVpsTarget } =
			await import('#/adapters/hetzner/target.ts')

		await dnsCommand(APP_WITH_DOMAIN)

		expect(loadR2Runtime).toHaveBeenCalledWith('cf-token')
		expect(HetznerVpsTarget).toHaveBeenCalled()
		expect(mockHetznerReconcileDns).toHaveBeenCalledWith(
			'my-app',
			'example.com',
		)
	})
})
