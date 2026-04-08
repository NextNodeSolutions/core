import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { syncPagesEnvCommand } from './sync-pages-env.command.ts'

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

function extractBody(fetchMock: ReturnType<typeof vi.fn<FetchImpl>>): unknown {
	const call = fetchMock.mock.calls[0]
	if (!call) throw new Error('fetch was not called')
	const body = call[1]?.body
	if (typeof body !== 'string') throw new Error('body is not a string')
	return JSON.parse(body)
}

function stubFetch(): ReturnType<typeof vi.fn<FetchImpl>> {
	const fetchMock = vi
		.fn<FetchImpl>()
		.mockResolvedValue(okJson({ success: true, result: {}, errors: [] }))
	vi.stubGlobal('fetch', fetchMock)
	return fetchMock
}

describe('syncPagesEnvCommand', () => {
	let configFile: string

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		configFile = join(tmpdir(), `nextnode-${id}.toml`)
		vi.stubEnv('PIPELINE_CONFIG_FILE', configFile)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
	})

	afterEach(() => {
		rmSync(configFile, { force: true })
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('pushes SITE_URL as plain_text', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\n',
		)
		const fetchMock = stubFetch()

		await syncPagesEnvCommand()

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

	it('picks declared secrets from ALL_SECRETS as secret_text', async () => {
		writeFileSync(
			configFile,
			[
				'[project]',
				'name = "my-site"',
				'type = "static"',
				'domain = "example.com"',
				'',
				'[deploy]',
				'secrets = ["RESEND_API_KEY"]',
			].join('\n'),
		)
		vi.stubEnv(
			'ALL_SECRETS',
			JSON.stringify({
				RESEND_API_KEY: 'resend-123',
				NPM_TOKEN: 'should-not-appear',
			}),
		)
		const fetchMock = stubFetch()

		await syncPagesEnvCommand()

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

	it('throws when a declared secret is missing from ALL_SECRETS', async () => {
		writeFileSync(
			configFile,
			[
				'[project]',
				'name = "my-site"',
				'type = "static"',
				'domain = "example.com"',
				'',
				'[deploy]',
				'secrets = ["MISSING_KEY"]',
			].join('\n'),
		)
		vi.stubEnv('ALL_SECRETS', JSON.stringify({}))
		stubFetch()

		await expect(syncPagesEnvCommand()).rejects.toThrow(
			'Secret "MISSING_KEY" declared in deploy.secrets but not found',
		)
	})

	it('skips silently for package projects', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-lib"\ntype = "package"\n',
		)
		vi.stubEnv('PIPELINE_ENVIRONMENT', undefined)
		const fetchMock = vi.fn<FetchImpl>()
		vi.stubGlobal('fetch', fetchMock)

		await syncPagesEnvCommand()

		expect(fetchMock).not.toHaveBeenCalled()
	})
})
