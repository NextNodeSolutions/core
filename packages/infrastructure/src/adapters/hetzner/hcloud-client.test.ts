import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	applyFirewall,
	createFirewall,
	createServer,
	deleteServer,
	describeServer,
} from './hcloud-client.ts'

const TOKEN = 'hcloud-test-token'

interface MockResponse {
	ok: boolean
	status: number
	json: () => Promise<unknown>
	text: () => Promise<string>
}

function okJson(body: unknown): MockResponse {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	}
}

function noContent(): MockResponse {
	return {
		ok: true,
		status: 204,
		json: () => Promise.resolve(null),
		text: () => Promise.resolve(''),
	}
}

function httpError(status: number, body: string): MockResponse {
	return {
		ok: false,
		status,
		json: () => Promise.resolve({}),
		text: () => Promise.resolve(body),
	}
}

function lastCall(mock: ReturnType<typeof vi.fn>): [string, RequestInit] {
	const call = mock.mock.lastCall
	if (!call) throw new Error('No calls recorded')
	return [call[0], call[1]]
}

function lastBody(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
	const [, init] = lastCall(mock)
	return JSON.parse(String(init.body))
}

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
	sshKeys: ['nextnode-ci'],
	userData: '#cloud-config\n',
	labels: { project: 'acme-web' },
} as const

describe('createServer', () => {
	it('sends correct payload and returns parsed server', async () => {
		const mock = vi.fn().mockResolvedValue(okJson(serverPayload))
		vi.stubGlobal('fetch', mock)

		const result = await createServer(TOKEN, createServerInput)

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
		expect(body.ssh_keys).toStrictEqual(['nextnode-ci'])
		expect(body.start_after_create).toBe(true)
	})

	it('includes auth header', async () => {
		const mock = vi.fn().mockResolvedValue(okJson(serverPayload))
		vi.stubGlobal('fetch', mock)

		await createServer(TOKEN, createServerInput)

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

		await expect(createServer(TOKEN, createServerInput)).rejects.toThrow(
			/create server "acme-web".*422.*server_type invalid/,
		)
	})
})

describe('describeServer', () => {
	it('fetches server by id', async () => {
		const mock = vi.fn().mockResolvedValue(okJson(serverPayload))
		vi.stubGlobal('fetch', mock)

		const result = await describeServer(TOKEN, 123)

		expect(result.id).toBe(123)
		const [url] = lastCall(mock)
		expect(url).toBe('https://api.hetzner.cloud/v1/servers/123')
	})

	it('throws on 404', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(404, 'not found')),
		)

		await expect(describeServer(TOKEN, 999)).rejects.toThrow(
			/describe server 999.*404/,
		)
	})
})

describe('deleteServer', () => {
	it('sends DELETE request', async () => {
		const mock = vi.fn().mockResolvedValue(noContent())
		vi.stubGlobal('fetch', mock)

		await deleteServer(TOKEN, 123)

		const [url, init] = lastCall(mock)
		expect(url).toBe('https://api.hetzner.cloud/v1/servers/123')
		expect(init.method).toBe('DELETE')
	})

	it('throws on error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(403, 'forbidden')),
		)

		await expect(deleteServer(TOKEN, 123)).rejects.toThrow(
			/delete server 123.*403/,
		)
	})
})

describe('createFirewall', () => {
	const firewallPayload = {
		firewall: { id: 42, name: 'acme-web-fw' },
	}

	it('sends rules and returns parsed firewall', async () => {
		const mock = vi.fn().mockResolvedValue(okJson(firewallPayload))
		vi.stubGlobal('fetch', mock)

		const rules = [
			{
				description: 'Allow SSH',
				direction: 'in' as const,
				protocol: 'tcp' as const,
				port: '22',
				source_ips: ['0.0.0.0/0', '::/0'],
			},
		]

		const result = await createFirewall(TOKEN, 'acme-web-fw', rules)

		expect(result.id).toBe(42)
		expect(result.name).toBe('acme-web-fw')

		const body = lastBody(mock)
		expect(body.name).toBe('acme-web-fw')
		expect(body.rules).toStrictEqual(rules)
	})
})

describe('applyFirewall', () => {
	it('sends correct apply_to payload', async () => {
		const mock = vi.fn().mockResolvedValue(okJson({ actions: [] }))
		vi.stubGlobal('fetch', mock)

		await applyFirewall(TOKEN, 42, 123)

		const [url] = lastCall(mock)
		expect(url).toBe(
			'https://api.hetzner.cloud/v1/firewalls/42/actions/apply_to_resources',
		)
		const body = lastBody(mock)
		expect(body.apply_to).toStrictEqual([
			{ type: 'server', server: { id: 123 } },
		])
	})

	it('throws on error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(404, 'firewall not found')),
		)

		await expect(applyFirewall(TOKEN, 99, 123)).rejects.toThrow(
			/apply firewall 99 to server 123.*404/,
		)
	})
})
