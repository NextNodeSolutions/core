import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	createDnsRecord,
	listDnsRecords,
	lookupZoneId,
	updateDnsRecord,
} from './cloudflare-dns.js'

const TOKEN = 'cf-token-123'

function okJson(body: unknown): {
	ok: true
	status: 200
	json: () => Promise<unknown>
	text: () => Promise<string>
} {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	}
}

function httpError(
	status: number,
	body: string,
): {
	ok: false
	status: number
	text: () => Promise<string>
	json: () => Promise<unknown>
} {
	return {
		ok: false,
		status,
		text: () => Promise.resolve(body),
		json: () => Promise.resolve({}),
	}
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('lookupZoneId', () => {
	it('returns the first matching zone id', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			okJson({
				success: true,
				result: [{ id: 'zone-1', name: 'example.com' }],
				errors: [],
			}),
		)
		vi.stubGlobal('fetch', fetchMock)

		const id = await lookupZoneId('example.com', TOKEN)

		expect(id).toBe('zone-1')
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.cloudflare.com/client/v4/zones?name=example.com',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: `Bearer ${TOKEN}`,
				}),
			}),
		)
	})

	it('throws when the zone list is empty', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValue(
					okJson({ success: true, result: [], errors: [] }),
				),
		)

		await expect(lookupZoneId('missing.com', TOKEN)).rejects.toThrow(
			'Cloudflare zone not found for "missing.com"',
		)
	})

	it('throws on HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(401, 'unauthorized')),
		)

		await expect(lookupZoneId('example.com', TOKEN)).rejects.toThrow(
			'Cloudflare API returned 401',
		)
	})

	it('throws when the API reports success=false', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: false,
					result: [],
					errors: [{ code: 6003, message: 'Invalid request' }],
				}),
			),
		)

		await expect(lookupZoneId('example.com', TOKEN)).rejects.toThrow(
			'[6003] Invalid request',
		)
	})
})

describe('listDnsRecords', () => {
	it('returns the records found for the name+type combination', async () => {
		const records = [
			{
				id: 'rec-1',
				type: 'CNAME',
				name: 'example.com',
				content: 'my-site.pages.dev',
				proxied: true,
				ttl: 1,
			},
		]
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				okJson({ success: true, result: records, errors: [] }),
			)
		vi.stubGlobal('fetch', fetchMock)

		const result = await listDnsRecords(
			'zone-1',
			'example.com',
			'CNAME',
			TOKEN,
		)

		expect(result).toEqual(records)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records?name=example.com&type=CNAME',
			expect.any(Object),
		)
	})

	it('throws on HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(500, 'server error')),
		)

		await expect(
			listDnsRecords('zone-1', 'example.com', 'CNAME', TOKEN),
		).rejects.toThrow('Cloudflare API returned 500')
	})
})

describe('createDnsRecord', () => {
	it('POSTs the payload and returns the created record', async () => {
		const created = {
			id: 'rec-new',
			type: 'CNAME',
			name: 'example.com',
			content: 'my-site.pages.dev',
			proxied: true,
			ttl: 1,
		}
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				okJson({ success: true, result: created, errors: [] }),
			)
		vi.stubGlobal('fetch', fetchMock)

		const result = await createDnsRecord(
			'zone-1',
			{
				type: 'CNAME',
				name: 'example.com',
				content: 'my-site.pages.dev',
				proxied: true,
				ttl: 1,
			},
			TOKEN,
		)

		expect(result).toEqual(created)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					type: 'CNAME',
					name: 'example.com',
					content: 'my-site.pages.dev',
					proxied: true,
					ttl: 1,
				}),
			}),
		)
	})

	it('throws on API failure', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				okJson({
					success: false,
					result: {},
					errors: [{ code: 81053, message: 'Record already exists' }],
				}),
			),
		)

		await expect(
			createDnsRecord(
				'zone-1',
				{
					type: 'CNAME',
					name: 'example.com',
					content: 'my-site.pages.dev',
					proxied: true,
					ttl: 1,
				},
				TOKEN,
			),
		).rejects.toThrow('[81053] Record already exists')
	})
})

describe('updateDnsRecord', () => {
	it('PUTs the payload at the record-specific URL', async () => {
		const updated = {
			id: 'rec-1',
			type: 'CNAME',
			name: 'example.com',
			content: 'new.pages.dev',
			proxied: true,
			ttl: 1,
		}
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				okJson({ success: true, result: updated, errors: [] }),
			)
		vi.stubGlobal('fetch', fetchMock)

		const result = await updateDnsRecord(
			'zone-1',
			'rec-1',
			{
				type: 'CNAME',
				name: 'example.com',
				content: 'new.pages.dev',
				proxied: true,
				ttl: 1,
			},
			TOKEN,
		)

		expect(result).toEqual(updated)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/rec-1',
			expect.objectContaining({ method: 'PUT' }),
		)
	})
})
