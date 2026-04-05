import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensurePagesProjectCommand } from './pages-project.command.ts'

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

describe('ensurePagesProjectCommand', () => {
	let configFile: string

	beforeEach(() => {
		configFile = join(
			tmpdir(),
			`nextnode-${Date.now()}-${Math.random().toString(36).slice(2)}.toml`,
		)
		vi.stubEnv('PIPELINE_CONFIG_FILE', configFile)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cf-token')
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-xyz')
	})

	afterEach(() => {
		rmSync(configFile, { force: true })
		vi.unstubAllEnvs()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('creates the project when it does not exist', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "gardefroidclim"\ntype = "static"\n',
		)

		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)
			if (
				url.endsWith('/pages/projects/gardefroidclim') &&
				method === 'GET'
			) {
				return Promise.resolve(notFound())
			}
			if (url.endsWith('/pages/projects') && method === 'POST') {
				return Promise.resolve(
					okJson({
						success: true,
						result: {
							name: 'gardefroidclim',
							production_branch: 'main',
						},
						errors: [],
					}),
				)
			}
			throw new Error(`Unexpected call: ${method} ${url}`)
		}
		const fetchMock = vi.fn<FetchImpl>(impl)
		vi.stubGlobal('fetch', fetchMock)

		await ensurePagesProjectCommand()

		const postCall = fetchMock.mock.calls.find(
			call => methodOf(call[1]) === 'POST',
		)
		expect(postCall).toBeDefined()
		if (!postCall) return
		const body = postCall[1]?.body
		expect(typeof body).toBe('string')
		if (typeof body !== 'string') return
		const payload: unknown = JSON.parse(body)
		expect(payload).toEqual({
			name: 'gardefroidclim',
			production_branch: 'main',
		})
	})

	it('creates the project with -dev suffix in development env', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "gardefroidclim"\ntype = "static"\n',
		)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')

		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)
			if (
				url.endsWith('/pages/projects/gardefroidclim-dev') &&
				method === 'GET'
			) {
				return Promise.resolve(notFound())
			}
			if (url.endsWith('/pages/projects') && method === 'POST') {
				return Promise.resolve(
					okJson({
						success: true,
						result: {
							name: 'gardefroidclim-dev',
							production_branch: 'main',
						},
						errors: [],
					}),
				)
			}
			throw new Error(`Unexpected call: ${method} ${url}`)
		}
		const fetchMock = vi.fn<FetchImpl>(impl)
		vi.stubGlobal('fetch', fetchMock)

		await ensurePagesProjectCommand()

		const postCall = fetchMock.mock.calls.find(
			call => methodOf(call[1]) === 'POST',
		)
		expect(postCall).toBeDefined()
		if (!postCall) return
		const body = postCall[1]?.body
		expect(typeof body).toBe('string')
		if (typeof body !== 'string') return
		const payload: unknown = JSON.parse(body)
		expect(payload).toEqual({
			name: 'gardefroidclim-dev',
			production_branch: 'main',
		})
	})

	it('skips creation when the project already exists', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "gardefroidclim"\ntype = "static"\n',
		)

		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)
			if (
				url.endsWith('/pages/projects/gardefroidclim') &&
				method === 'GET'
			) {
				return Promise.resolve(
					okJson({
						success: true,
						result: {
							name: 'gardefroidclim',
							production_branch: 'main',
						},
						errors: [],
					}),
				)
			}
			throw new Error(`Unexpected call: ${method} ${url}`)
		}
		const fetchMock = vi.fn<FetchImpl>(impl)
		vi.stubGlobal('fetch', fetchMock)

		await ensurePagesProjectCommand()

		const methods = fetchMock.mock.calls.map(call => methodOf(call[1]))
		expect(methods).not.toContain('POST')
	})

	it('throws when PIPELINE_CONFIG_FILE is not set', async () => {
		vi.stubEnv('PIPELINE_CONFIG_FILE', undefined)

		await expect(ensurePagesProjectCommand()).rejects.toThrow(
			'PIPELINE_CONFIG_FILE env var',
		)
	})

	it('throws when CLOUDFLARE_ACCOUNT_ID is not set', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "gardefroidclim"\ntype = "static"\n',
		)
		vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', undefined)

		await expect(ensurePagesProjectCommand()).rejects.toThrow(
			'CLOUDFLARE_ACCOUNT_ID env var',
		)
	})

	it('throws when CLOUDFLARE_API_TOKEN is not set', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "gardefroidclim"\ntype = "static"\n',
		)
		vi.stubEnv('CLOUDFLARE_API_TOKEN', undefined)

		await expect(ensurePagesProjectCommand()).rejects.toThrow(
			'CLOUDFLARE_API_TOKEN env var',
		)
	})

	it('propagates unexpected HTTP errors on GET', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "gardefroidclim"\ntype = "static"\n',
		)

		const impl: FetchImpl = () =>
			Promise.resolve({
				ok: false,
				status: 403,
				json: () => Promise.resolve({}),
				text: () => Promise.resolve('forbidden'),
			})
		vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))

		await expect(ensurePagesProjectCommand()).rejects.toThrow(
			'Cloudflare API returned 403',
		)
	})
})
