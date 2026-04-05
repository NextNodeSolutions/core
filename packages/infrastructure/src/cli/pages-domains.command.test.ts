import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensurePagesDomainsCommand } from './pages-domains.command.ts'

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

describe('ensurePagesDomainsCommand', () => {
	let configFile: string

	beforeEach(() => {
		configFile = join(
			tmpdir(),
			`nextnode-${Date.now()}-${Math.random().toString(36).slice(2)}.toml`,
		)
		vi.stubEnv('PIPELINE_CONFIG_FILE', configFile)
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-abc')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
	})

	afterEach(() => {
		rmSync(configFile, { force: true })
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('skips when no domain is configured', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\n',
		)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		const fetchMock = vi.fn<FetchImpl>()
		vi.stubGlobal('fetch', fetchMock)

		await ensurePagesDomainsCommand()

		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('attaches the root domain and every redirect in production', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\nredirect_domains = ["example.fr"]\n',
		)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')

		const attachedBodies: string[] = []
		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)
			if (
				url.endsWith('/pages/projects/my-site/domains') &&
				method === 'GET'
			) {
				return Promise.resolve(
					okJson({ success: true, result: [], errors: [] }),
				)
			}
			if (
				url.endsWith('/pages/projects/my-site/domains') &&
				method === 'POST'
			) {
				const body = init?.body
				if (typeof body === 'string') attachedBodies.push(body)
				return Promise.resolve(
					okJson({
						success: true,
						result: { name: 'x', status: 'initializing' },
						errors: [],
					}),
				)
			}
			throw new Error(`Unexpected call: ${method} ${url}`)
		}
		vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))

		await ensurePagesDomainsCommand()

		expect(attachedBodies.map(body => JSON.parse(body))).toEqual([
			{ name: 'example.com' },
			{ name: 'example.fr' },
		])
	})

	it('skips POST for domains already attached', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\n',
		)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')

		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)
			if (
				url.endsWith('/pages/projects/my-site/domains') &&
				method === 'GET'
			) {
				return Promise.resolve(
					okJson({
						success: true,
						result: [{ name: 'example.com', status: 'active' }],
						errors: [],
					}),
				)
			}
			throw new Error(`Unexpected call: ${method} ${url}`)
		}
		const fetchMock = vi.fn<FetchImpl>(impl)
		vi.stubGlobal('fetch', fetchMock)

		await ensurePagesDomainsCommand()

		const methods = fetchMock.mock.calls.map(call => methodOf(call[1]))
		expect(methods).not.toContain('POST')
	})

	it('attaches only dev.{domain} to the -dev project in development, ignoring redirects', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\nredirect_domains = ["example.fr"]\n',
		)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')

		const attachedBodies: string[] = []
		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)
			if (
				url.endsWith('/pages/projects/my-site-dev/domains') &&
				method === 'GET'
			) {
				return Promise.resolve(
					okJson({ success: true, result: [], errors: [] }),
				)
			}
			if (
				url.endsWith('/pages/projects/my-site-dev/domains') &&
				method === 'POST'
			) {
				const body = init?.body
				if (typeof body === 'string') attachedBodies.push(body)
				return Promise.resolve(
					okJson({
						success: true,
						result: {
							name: 'dev.example.com',
							status: 'initializing',
						},
						errors: [],
					}),
				)
			}
			throw new Error(`Unexpected call: ${method} ${url}`)
		}
		vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))

		await ensurePagesDomainsCommand()

		expect(attachedBodies.map(body => JSON.parse(body))).toEqual([
			{ name: 'dev.example.com' },
		])
	})

	it('leaves stale attached domains untouched (no DELETE calls)', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\n',
		)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')

		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)
			if (
				url.endsWith('/pages/projects/my-site/domains') &&
				method === 'GET'
			) {
				return Promise.resolve(
					okJson({
						success: true,
						result: [
							{ name: 'example.com', status: 'active' },
							{ name: 'legacy.example.com', status: 'active' },
						],
						errors: [],
					}),
				)
			}
			throw new Error(`Unexpected call: ${method} ${url}`)
		}
		const fetchMock = vi.fn<FetchImpl>(impl)
		vi.stubGlobal('fetch', fetchMock)

		await ensurePagesDomainsCommand()

		const methods = fetchMock.mock.calls.map(call => methodOf(call[1]))
		expect(methods).toEqual(['GET'])
	})

	it('throws when CLOUDFLARE_ACCOUNT_ID is missing but domain exists', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\n',
		)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', undefined)

		await expect(ensurePagesDomainsCommand()).rejects.toThrow(
			'CLOUDFLARE_ACCOUNT_ID env var',
		)
	})

	it('throws when CLOUDFLARE_API_TOKEN is missing but domain exists', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\n',
		)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', undefined)

		await expect(ensurePagesDomainsCommand()).rejects.toThrow(
			'CLOUDFLARE_API_TOKEN env var',
		)
	})

	it('rejects package project types', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "package"\ndomain = "example.com"\n',
		)

		await expect(ensurePagesDomainsCommand()).rejects.toThrow(
			'Pages custom domains are not supported for package projects',
		)
	})
})
