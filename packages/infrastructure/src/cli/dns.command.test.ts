import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dnsCommand } from './dns.command.js'

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

describe('dnsCommand', () => {
	let configFile: string
	const savedEnv: Record<string, string | undefined> = {}

	beforeEach(() => {
		configFile = join(
			tmpdir(),
			`nextnode-${Date.now()}-${Math.random().toString(36).slice(2)}.toml`,
		)
		savedEnv['PIPELINE_CONFIG_FILE'] = process.env['PIPELINE_CONFIG_FILE']
		savedEnv['PIPELINE_ENVIRONMENT'] = process.env['PIPELINE_ENVIRONMENT']
		savedEnv['CLOUDFLARE_API_TOKEN'] = process.env['CLOUDFLARE_API_TOKEN']
		process.env['PIPELINE_CONFIG_FILE'] = configFile
		process.env['CLOUDFLARE_API_TOKEN'] = 'cf-token'
	})

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				delete process.env[key]
			} else {
				process.env[key] = value
			}
		}
		rmSync(configFile, { force: true })
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('skips when no domain is configured', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\n',
		)
		process.env['PIPELINE_ENVIRONMENT'] = 'production'
		const fetchMock = vi.fn<FetchImpl>()
		vi.stubGlobal('fetch', fetchMock)

		await dnsCommand()

		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('creates the root CNAME in production when no existing record exists', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\n',
		)
		process.env['PIPELINE_ENVIRONMENT'] = 'production'

		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)
			if (url.includes('/zones?name=example.com') && method === 'GET') {
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
							id: 'new-rec',
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
		vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))

		await expect(dnsCommand()).resolves.toBeUndefined()
	})

	it('skips the API write when existing record already matches', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\n',
		)
		process.env['PIPELINE_ENVIRONMENT'] = 'production'

		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)
			if (url.includes('/zones?name=example.com') && method === 'GET') {
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
					okJson({
						success: true,
						result: [
							{
								id: 'rec-existing',
								type: 'CNAME',
								name: 'example.com',
								content: 'my-site.pages.dev',
								proxied: true,
								ttl: 1,
							},
						],
						errors: [],
					}),
				)
			}
			throw new Error(`Unexpected call: ${method} ${url}`)
		}
		const fetchMock = vi.fn<FetchImpl>(impl)
		vi.stubGlobal('fetch', fetchMock)

		await dnsCommand()

		const methods = fetchMock.mock.calls.map(call => methodOf(call[1]))
		expect(methods).not.toContain('POST')
		expect(methods).not.toContain('PUT')
	})

	it('updates the record when proxied status differs', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\n',
		)
		process.env['PIPELINE_ENVIRONMENT'] = 'production'

		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)
			if (url.includes('/zones?name=example.com') && method === 'GET') {
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
					okJson({
						success: true,
						result: [
							{
								id: 'rec-stale',
								type: 'CNAME',
								name: 'example.com',
								content: 'my-site.pages.dev',
								proxied: false,
								ttl: 300,
							},
						],
						errors: [],
					}),
				)
			}
			if (url.includes('/dns_records/rec-stale') && method === 'PUT') {
				return Promise.resolve(
					okJson({
						success: true,
						result: {
							id: 'rec-stale',
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

		await dnsCommand()

		const putCall = fetchMock.mock.calls.find(
			call => methodOf(call[1]) === 'PUT',
		)
		expect(putCall).toBeDefined()
	})

	it('creates dev.{domain} unproxied in development', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\n',
		)
		process.env['PIPELINE_ENVIRONMENT'] = 'development'

		let postBody: string | undefined
		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)
			if (url.includes('/zones?name=example.com') && method === 'GET') {
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
				const body = init?.body
				postBody = typeof body === 'string' ? body : undefined
				return Promise.resolve(
					okJson({
						success: true,
						result: {
							id: 'rec-new',
							type: 'CNAME',
							name: 'dev.example.com',
							content: 'my-site.pages.dev',
							proxied: false,
							ttl: 300,
						},
						errors: [],
					}),
				)
			}
			throw new Error(`Unexpected call: ${method} ${url}`)
		}
		vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))

		await dnsCommand()

		expect(postBody).toBeDefined()
		if (!postBody) return
		const payload: unknown = JSON.parse(postBody)
		expect(payload).toEqual({
			type: 'CNAME',
			name: 'dev.example.com',
			content: 'my-site.pages.dev',
			proxied: false,
			ttl: 300,
		})
	})

	it('caches zone lookups per zone across redirect domains', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\nredirect_domains = ["alt.example.com", "other.net"]\n',
		)
		process.env['PIPELINE_ENVIRONMENT'] = 'production'

		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)
			if (url.includes('/zones?name=example.com') && method === 'GET') {
				return Promise.resolve(
					okJson({
						success: true,
						result: [{ id: 'zone-1', name: 'example.com' }],
						errors: [],
					}),
				)
			}
			if (url.includes('/zones?name=other.net') && method === 'GET') {
				return Promise.resolve(
					okJson({
						success: true,
						result: [{ id: 'zone-2', name: 'other.net' }],
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
							id: 'rec-x',
							type: 'CNAME',
							name: 'x',
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

		await dnsCommand()

		const zoneLookups = fetchMock.mock.calls.filter(call =>
			urlOf(call[0]).includes('/zones?name='),
		)
		// example.com is cached and reused for example.com + alt.example.com.
		// other.net gets its own lookup.
		expect(zoneLookups).toHaveLength(2)
	})

	it('throws when PIPELINE_CONFIG_FILE is not set', async () => {
		delete process.env['PIPELINE_CONFIG_FILE']

		await expect(dnsCommand()).rejects.toThrow(
			'PIPELINE_CONFIG_FILE env var',
		)
	})

	it('throws when CLOUDFLARE_API_TOKEN is missing but domain exists', async () => {
		writeFileSync(
			configFile,
			'[project]\nname = "my-site"\ntype = "static"\ndomain = "example.com"\n',
		)
		process.env['PIPELINE_ENVIRONMENT'] = 'production'
		delete process.env['CLOUDFLARE_API_TOKEN']

		await expect(dnsCommand()).rejects.toThrow(
			'CLOUDFLARE_API_TOKEN env var',
		)
	})
})
