import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

import type { DeployResult } from '../../domain/deploy/target.ts'
import {
	APP_WITH_DOMAIN,
	APP_WITH_SECRETS,
	STATIC_NO_DOMAIN,
	STATIC_WITH_DOMAIN,
	STATIC_WITH_MISSING_SECRET,
	STATIC_WITH_SECRETS,
} from '../fixtures.ts'

import { deployCommand } from './deploy.command.ts'
import type { FetchImpl } from './test-utils.ts'
import { okJson } from './test-utils.ts'

function stubFetch(): ReturnType<typeof vi.fn<FetchImpl>> {
	const fetchMock = vi
		.fn<FetchImpl>()
		.mockResolvedValue(okJson({ success: true, result: {}, errors: [] }))
	vi.stubGlobal('fetch', fetchMock)
	return fetchMock
}

function stubFetchWithProject(
	subdomain: string,
): ReturnType<typeof vi.fn<FetchImpl>> {
	const impl: FetchImpl = (input, init) => {
		const url = typeof input === 'string' ? input : input.toString()
		const method = init?.method ?? 'GET'
		if (url.includes('/pages/projects/') && method === 'GET') {
			return Promise.resolve(
				okJson({
					success: true,
					result: {
						name: 'my-site',
						production_branch: 'main',
						subdomain,
					},
					errors: [],
				}),
			)
		}
		return Promise.resolve(
			okJson({ success: true, result: {}, errors: [] }),
		)
	}
	const fetchMock = vi.fn<FetchImpl>(impl)
	vi.stubGlobal('fetch', fetchMock)
	return fetchMock
}

function extractPatchBody(
	fetchMock: ReturnType<typeof vi.fn<FetchImpl>>,
): unknown {
	const call = fetchMock.mock.calls.find(c => c[1]?.method === 'PATCH')
	if (!call) throw new Error('no PATCH call recorded')
	const body = call[1]?.body
	if (typeof body !== 'string') throw new Error('body is not a string')
	return JSON.parse(body)
}

// Mock Hetzner adapter boundaries so createTarget works for hetzner-vps configs
// without needing real SSH/R2/Hetzner API connectivity
const { mockHetznerDeploy } = vi.hoisted(() => ({
	mockHetznerDeploy: vi.fn(),
}))

// Mock loadR2Runtime (network boundary: Cloudflare accounts API + SigV4 verify).
// Deploy must NOT call ensureR2Setup — R2 bootstrap is provision's responsibility.
vi.mock(import('../r2/load-runtime.ts'), async () => ({
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
vi.mock('../../adapters/hetzner/target.ts', () => ({
	HetznerVpsTarget: vi.fn(() => ({
		name: 'hetzner-vps',
		computeDeployEnv: () => ({ SITE_URL: 'https://example.com' }),
		deploy: mockHetznerDeploy,
		ensureInfra: vi.fn(),
		reconcileDns: vi.fn(),
	})),
}))

describe('deployCommand', () => {
	let envFile: string
	let summaryFile: string

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		envFile = join(tmpdir(), `gh-env-${id}.txt`)
		summaryFile = join(tmpdir(), `gh-summary-${id}.txt`)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('GITHUB_ENV', envFile)
		vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile)
	})

	afterEach(() => {
		rmSync(envFile, { force: true })
		rmSync(summaryFile, { force: true })
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	describe('static (cloudflare-pages)', () => {
		it('writes SITE_URL to GITHUB_ENV and syncs env vars to Pages', async () => {
			const fetchMock = stubFetch()

			await deployCommand(STATIC_WITH_DOMAIN)

			const ghEnv = readFileSync(envFile, 'utf-8')
			expect(ghEnv).toContain('SITE_URL=https://example.com\n')

			expect(extractPatchBody(fetchMock)).toStrictEqual({
				deployment_configs: {
					production: {
						env_vars: {
							SITE_URL: {
								type: 'plain_text',
								value: 'https://example.com',
							},
						},
					},
				},
			})
		})

		it('writes dev SITE_URL in development', async () => {
			vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')
			stubFetch()

			await deployCommand(STATIC_WITH_DOMAIN)

			const ghEnv = readFileSync(envFile, 'utf-8')
			expect(ghEnv).toContain('SITE_URL=https://dev.example.com\n')
		})

		it('uses the live CF subdomain (auto-suffixed) when no domain is set', async () => {
			stubFetchWithProject('my-site-6zu.pages.dev')

			await deployCommand(STATIC_NO_DOMAIN)

			const ghEnv = readFileSync(envFile, 'utf-8')
			expect(ghEnv).toContain('SITE_URL=https://my-site-6zu.pages.dev\n')
		})

		it('picks declared secrets from ALL_SECRETS', async () => {
			vi.stubEnv(
				'ALL_SECRETS',
				JSON.stringify({
					RESEND_API_KEY: 'resend-123',
					NPM_TOKEN: 'should-not-appear',
				}),
			)
			const fetchMock = stubFetch()

			await deployCommand(STATIC_WITH_SECRETS)

			expect(extractPatchBody(fetchMock)).toStrictEqual({
				deployment_configs: {
					production: {
						env_vars: {
							SITE_URL: {
								type: 'plain_text',
								value: 'https://example.com',
							},
							RESEND_API_KEY: {
								type: 'secret_text',
								value: 'resend-123',
							},
						},
					},
				},
			})
		})

		it('throws when a declared secret is missing', async () => {
			vi.stubEnv('ALL_SECRETS', JSON.stringify({}))
			stubFetch()

			await expect(
				deployCommand(STATIC_WITH_MISSING_SECRET),
			).rejects.toThrow(
				'Secret "MISSING_KEY" declared in deploy.secrets but not found',
			)
		})
	})

	describe('container (hetzner-vps)', () => {
		const HETZNER_DEPLOY_RESULT: DeployResult = {
			projectName: 'my-app',
			deployedEnvironments: [
				{
					kind: 'container',
					name: 'production',
					url: 'https://example.com',
					imageRef: {
						registry: 'ghcr.io',
						repository: 'acme/web',
						tag: 'sha-abc123',
					},
					deployedAt: new Date('2026-01-01'),
				},
			],
			durationMs: 42,
		}

		let testPrivateKey: string

		beforeAll(() => {
			testPrivateKey = sshUtils.generateKeyPairSync('ed25519').private
		})

		beforeEach(() => {
			vi.stubEnv('HETZNER_API_TOKEN', 'hcloud-token')
			vi.stubEnv(
				'DEPLOY_SSH_PRIVATE_KEY_B64',
				Buffer.from(testPrivateKey).toString('base64'),
			)
			vi.stubEnv('TAILSCALE_AUTH_KEY', 'tskey-auth-test')
			vi.stubEnv('GHCR_TOKEN', 'ghs_fake_token')
			vi.stubEnv('IMAGE_REF', 'ghcr.io/acme/web:sha-abc123')
			mockHetznerDeploy.mockResolvedValue(HETZNER_DEPLOY_RESULT)
		})

		it('writes computed deploy env to GITHUB_ENV', async () => {
			await deployCommand(APP_WITH_DOMAIN)

			const ghEnv = readFileSync(envFile, 'utf-8')
			expect(ghEnv).toContain('SITE_URL=https://example.com\n')
		})

		it('writes deploy summary to GITHUB_STEP_SUMMARY', async () => {
			await deployCommand(APP_WITH_DOMAIN)

			const summary = readFileSync(summaryFile, 'utf-8')
			expect(summary).toContain('Deployed `my-app` to production')
			expect(summary).toContain('https://example.com')
			expect(summary).toContain('ghcr.io/acme/web:sha-abc123')
			expect(summary).toContain('hetzner-vps')
		})

		it('passes parsed IMAGE_REF and empty secrets to the target', async () => {
			await deployCommand(APP_WITH_DOMAIN)

			expect(mockHetznerDeploy).toHaveBeenCalledWith(
				'my-app',
				{
					secrets: {},
					image: {
						registry: 'ghcr.io',
						repository: 'acme/web',
						tag: 'sha-abc123',
					},
					registryToken: 'ghs_fake_token',
				},
				{ SITE_URL: 'https://example.com' },
			)
		})

		it('picks declared secrets from ALL_SECRETS and passes them to the target', async () => {
			vi.stubEnv(
				'ALL_SECRETS',
				JSON.stringify({
					DATABASE_URL: 'postgres://db:5432',
					NPM_TOKEN: 'should-not-appear',
				}),
			)

			await deployCommand(APP_WITH_SECRETS)

			expect(mockHetznerDeploy).toHaveBeenCalledWith(
				'my-app',
				expect.objectContaining({
					secrets: { DATABASE_URL: 'postgres://db:5432' },
				}),
				{ SITE_URL: 'https://example.com' },
			)
		})

		it('throws when IMAGE_REF is missing', async () => {
			vi.stubEnv('IMAGE_REF', '')

			await expect(deployCommand(APP_WITH_DOMAIN)).rejects.toThrow(
				'IMAGE_REF env var is required',
			)
		})

		it('throws when IMAGE_REF is malformed', async () => {
			vi.stubEnv('IMAGE_REF', 'no-tag-here')

			await expect(deployCommand(APP_WITH_DOMAIN)).rejects.toThrow(
				'Invalid image ref',
			)
		})
	})
})
