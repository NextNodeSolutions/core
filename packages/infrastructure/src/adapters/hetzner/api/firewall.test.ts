import {
	httpError,
	lastBody,
	lastCall,
	noContent,
	okJson,
} from '#/test-fetch.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	applyFirewall,
	createFirewall,
	deleteFirewall,
	findFirewallById,
	findFirewallsByName,
} from './firewall.ts'

const TEST_TOKEN = 'hcloud-test-token'

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('findFirewallsByName', () => {
	const firewallListPayload = {
		firewalls: [{ id: 42, name: 'acme-web-fw' }],
	}

	it('sends name query param and returns parsed firewalls', async () => {
		const mock = vi.fn().mockResolvedValue(okJson(firewallListPayload))
		vi.stubGlobal('fetch', mock)

		const result = await findFirewallsByName(TEST_TOKEN, 'acme-web-fw')

		expect(result).toHaveLength(1)
		expect(result[0]!.id).toBe(42)
		expect(result[0]!.name).toBe('acme-web-fw')

		const [url] = lastCall(mock)
		expect(url).toContain('/firewalls?name=acme-web-fw')
	})

	it('returns empty array when no firewalls match', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(okJson({ firewalls: [] })),
		)

		const result = await findFirewallsByName(TEST_TOKEN, 'nonexistent')

		expect(result).toHaveLength(0)
	})

	it('throws on HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(401, 'unauthorized')),
		)

		await expect(
			findFirewallsByName(TEST_TOKEN, 'acme-web-fw'),
		).rejects.toThrow(/list firewalls.*401.*unauthorized/)
	})

	it('throws on missing firewalls array in response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(okJson({ unexpected: true })),
		)

		await expect(
			findFirewallsByName(TEST_TOKEN, 'acme-web-fw'),
		).rejects.toThrow(/missing `firewalls` array/)
	})
})

describe('findFirewallById', () => {
	it('reports the number of resources the firewall is applied to', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					firewall: {
						id: 42,
						name: 'acme-web-fw',
						applied_to: [
							{ type: 'server', server: { id: 1001 } },
							{ type: 'server', server: { id: 1002 } },
						],
					},
				}),
			),
		)

		const firewall = await findFirewallById(TEST_TOKEN, 42)

		expect(firewall).not.toBeNull()
		expect(firewall?.appliedToCount).toBe(2)
	})

	it('returns null when the firewall does not exist', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(404, 'not found')),
		)

		const firewall = await findFirewallById(TEST_TOKEN, 42)

		expect(firewall).toBeNull()
	})
})

describe('deleteFirewall', () => {
	it('sends DELETE request to correct URL', async () => {
		const mock = vi.fn().mockResolvedValue(noContent())
		vi.stubGlobal('fetch', mock)

		await deleteFirewall(TEST_TOKEN, 42)

		const [url, init] = lastCall(mock)
		expect(url).toBe('https://api.hetzner.cloud/v1/firewalls/42')
		expect(init.method).toBe('DELETE')
	})

	it('returns silently when firewall is already gone (404)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(404, 'not found')),
		)

		await expect(deleteFirewall(TEST_TOKEN, 42)).resolves.toBeUndefined()
	})

	it('throws on non-404 error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(403, 'forbidden')),
		)

		await expect(deleteFirewall(TEST_TOKEN, 42)).rejects.toThrow(
			/delete firewall 42.*403/,
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

		const result = await createFirewall(TEST_TOKEN, 'acme-web-fw', rules)

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

		await applyFirewall(TEST_TOKEN, 42, 123)

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

		await expect(applyFirewall(TEST_TOKEN, 99, 123)).rejects.toThrow(
			/apply firewall 99 to server 123.*404/,
		)
	})
})
