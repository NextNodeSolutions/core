import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deployCommand } from './deploy.command.ts'
import {
	STATIC_NO_DOMAIN,
	STATIC_WITH_DOMAIN,
	STATIC_WITH_MISSING_SECRET,
	STATIC_WITH_SECRETS,
} from './fixtures.ts'

interface MockResponse {
	ok: boolean
	status: number
	json: () => Promise<unknown>
	text: () => Promise<string>
}

type FetchImpl = (
	input: string | URL,
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

function stubFetch(): ReturnType<typeof vi.fn<FetchImpl>> {
	const fetchMock = vi
		.fn<FetchImpl>()
		.mockResolvedValue(okJson({ success: true, result: {}, errors: [] }))
	vi.stubGlobal('fetch', fetchMock)
	return fetchMock
}

function extractBody(fetchMock: ReturnType<typeof vi.fn<FetchImpl>>): unknown {
	const call = fetchMock.mock.calls[0]
	if (!call) throw new Error('fetch was not called')
	const body = call[1]?.body
	if (typeof body !== 'string') throw new Error('body is not a string')
	return JSON.parse(body)
}

describe('deployCommand', () => {
	let envFile: string

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		envFile = join(tmpdir(), `gh-env-${id}.txt`)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('GITHUB_ENV', envFile)
	})

	afterEach(() => {
		rmSync(envFile, { force: true })
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('writes SITE_URL to GITHUB_ENV and syncs env vars to Pages', async () => {
		const fetchMock = stubFetch()

		await deployCommand(STATIC_WITH_DOMAIN)

		const ghEnv = readFileSync(envFile, 'utf-8')
		expect(ghEnv).toContain('SITE_URL=https://example.com\n')

		expect(extractBody(fetchMock)).toStrictEqual({
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

	it('falls back to pages.dev when no domain', async () => {
		stubFetch()

		await deployCommand(STATIC_NO_DOMAIN)

		const ghEnv = readFileSync(envFile, 'utf-8')
		expect(ghEnv).toContain('SITE_URL=https://my-site.pages.dev\n')
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

		expect(extractBody(fetchMock)).toStrictEqual({
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

		await expect(deployCommand(STATIC_WITH_MISSING_SECRET)).rejects.toThrow(
			'Secret "MISSING_KEY" declared in deploy.secrets but not found',
		)
	})
})
