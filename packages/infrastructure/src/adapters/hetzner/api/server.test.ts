import { afterEach, describe, expect, it, vi } from 'vitest'

import { createServer, deleteServer, describeServer } from './server.ts'
import {
	TEST_TOKEN,
	httpError,
	lastBody,
	lastCall,
	noContent,
	okJson,
} from './test-helpers.ts'

afterEach(() => {
	vi.unstubAllGlobals()
})

const serverPayload = {
	server: {
		id: 123,
		name: 'acme-web',
		status: 'running',
		public_net: { ipv4: { ip: '1.2.3.4' } },
	},
}

const createServerInput = {
	name: 'acme-web',
	serverType: 'cpx22',
	location: 'nbg1',
	image: 'ubuntu-24.04',
	userData: '#cloud-config\n',
	labels: { project: 'acme-web' },
} as const

describe('createServer', () => {
	it('sends correct payload and returns parsed server', async () => {
		const mock = vi.fn().mockResolvedValue(okJson(serverPayload))
		vi.stubGlobal('fetch', mock)

		const result = await createServer(TEST_TOKEN, createServerInput)

		expect(result.id).toBe(123)
		expect(result.name).toBe('acme-web')
		expect(result.public_net.ipv4.ip).toBe('1.2.3.4')

		const [url] = lastCall(mock)
		expect(url).toBe('https://api.hetzner.cloud/v1/servers')
		const body = lastBody(mock)
		expect(body.name).toBe('acme-web')
		expect(body.server_type).toBe('cpx22')
		expect(body.location).toBe('nbg1')
		expect(body.image).toBe('ubuntu-24.04')
		expect(body.ssh_keys).toBeUndefined()
		expect(body.start_after_create).toBe(true)
	})

	it('includes auth header', async () => {
		const mock = vi.fn().mockResolvedValue(okJson(serverPayload))
		vi.stubGlobal('fetch', mock)

		await createServer(TEST_TOKEN, createServerInput)

		const [, init] = lastCall(mock)
		expect(init.headers).toStrictEqual(
			expect.objectContaining({
				Authorization: 'Bearer hcloud-test-token',
			}),
		)
	})

	it('throws on HTTP error with context', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(422, 'server_type invalid')),
		)

		await expect(
			createServer(TEST_TOKEN, createServerInput),
		).rejects.toThrow(/create server "acme-web".*422.*server_type invalid/)
	})
})

describe('describeServer', () => {
	it('fetches server by id', async () => {
		const mock = vi.fn().mockResolvedValue(okJson(serverPayload))
		vi.stubGlobal('fetch', mock)

		const result = await describeServer(TEST_TOKEN, 123)

		expect(result.id).toBe(123)
		const [url] = lastCall(mock)
		expect(url).toBe('https://api.hetzner.cloud/v1/servers/123')
	})

	it('throws on 404', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(404, 'not found')),
		)

		await expect(describeServer(TEST_TOKEN, 999)).rejects.toThrow(
			/describe server 999.*404/,
		)
	})
})

describe('deleteServer', () => {
	it('sends DELETE request', async () => {
		const mock = vi.fn().mockResolvedValue(noContent())
		vi.stubGlobal('fetch', mock)

		await deleteServer(TEST_TOKEN, 123)

		const [url, init] = lastCall(mock)
		expect(url).toBe('https://api.hetzner.cloud/v1/servers/123')
		expect(init.method).toBe('DELETE')
	})

	it('returns silently when server is already gone (404)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(404, 'not found')),
		)

		await expect(deleteServer(TEST_TOKEN, 123)).resolves.toBeUndefined()
	})

	it('throws on non-404 error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(403, 'forbidden')),
		)

		await expect(deleteServer(TEST_TOKEN, 123)).rejects.toThrow(
			/delete server 123.*403/,
		)
	})
})
