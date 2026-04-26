import { afterEach, describe, expect, it, vi } from 'vitest'

import { httpError, okJson } from '@/test-fetch.ts'

import {
	createDnsRecord,
	deleteDnsRecord,
	listDnsRecords,
	lookupZoneId,
	updateDnsRecord,
} from './api.ts'

const TOKEN = 'cf-token-123'

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
	it('returns all records for the given name', async () => {
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

		const result = await listDnsRecords('zone-1', 'example.com', TOKEN)

		expect(result).toEqual(records)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records?name=example.com',
			expect.any(Object),
		)
	})

	it('throws on HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(500, 'server error')),
		)

		await expect(
			listDnsRecords('zone-1', 'example.com', TOKEN),
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

describe('deleteDnsRecord', () => {
	it('sends a DELETE request to the record URL', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				okJson({ success: true, result: null, errors: [] }),
			)
		vi.stubGlobal('fetch', fetchMock)

		await deleteDnsRecord('zone-1', 'rec-1', TOKEN)

		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/rec-1',
			expect.objectContaining({ method: 'DELETE' }),
		)
	})

	it('throws on HTTP error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(httpError(404, 'not found')),
		)

		await expect(deleteDnsRecord('zone-1', 'rec-1', TOKEN)).rejects.toThrow(
			'Cloudflare API returned 404',
		)
	})
})
