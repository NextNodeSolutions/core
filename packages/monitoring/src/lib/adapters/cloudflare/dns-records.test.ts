import { afterEach, describe, expect, it, vi } from 'vitest'

import { listDnsRecordsByContent } from './dns-records.ts'

import type { CloudflareClient } from './client.ts'

const CLIENT: CloudflareClient = { accountId: 'acc', token: 'tok' }

const envelope = (records: ReadonlyArray<unknown>): Response =>
	new Response(
		JSON.stringify({
			success: true,
			errors: [],
			result: records,
			result_info: { total_pages: 1 },
		}),
		{ status: 200, headers: { 'content-type': 'application/json' } },
	)

const A_RECORD = {
	id: 'rec-1',
	name: 'app.stylot.app',
	type: 'A',
	content: '1.2.3.4',
	proxied: false,
	ttl: 1,
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('listDnsRecordsByContent', () => {
	it('falls back to the queried zoneId when Cloudflare omits zone_id on a record', async () => {
		// Cloudflare occasionally returns a record without `zone_id`; the record
		// still belongs to the zone in the request path, so it must not 500.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => envelope([A_RECORD])),
		)

		const records = await listDnsRecordsByContent({
			client: CLIENT,
			zoneId: 'zone-no-echo',
			zoneName: 'stylot.app',
			content: '1.2.3.4',
		})

		expect(records).toHaveLength(1)
		expect(records[0]?.zoneId).toBe('zone-no-echo')
		expect(records[0]?.zoneName).toBe('stylot.app')
	})

	it('prefers the record-level zone_id when present', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				envelope([{ ...A_RECORD, zone_id: 'zone-echoed' }]),
			),
		)

		const records = await listDnsRecordsByContent({
			client: CLIENT,
			zoneId: 'zone-requested',
			zoneName: 'other.app',
			content: '5.6.7.8',
		})

		expect(records[0]?.zoneId).toBe('zone-echoed')
	})

	it('still rejects a record missing `id`', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => envelope([{ name: 'x', content: 'y' }])),
		)

		await expect(
			listDnsRecordsByContent({
				client: CLIENT,
				zoneId: 'zone-bad-id',
				zoneName: 'broken.app',
				content: '9.9.9.9',
			}),
		).rejects.toThrow(/missing `id`/)
	})
})
