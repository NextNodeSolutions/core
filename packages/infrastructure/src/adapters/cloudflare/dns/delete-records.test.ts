import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DnsRecordLookup } from '../../../domain/cloudflare/dns-records.ts'

import { deleteDnsRecordsByName } from './delete-records.ts'

type FetchInput = string | URL
type FetchImpl = (
	input: FetchInput,
	init?: RequestInit,
) => Promise<{
	ok: boolean
	status: number
	json: () => Promise<unknown>
	text: () => Promise<string>
}>

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

function urlOf(input: FetchInput): string {
	return typeof input === 'string' ? input : input.toString()
}

function methodOf(init: RequestInit | undefined): string {
	return init?.method ?? 'GET'
}

afterEach(() => {
	vi.unstubAllGlobals()
	vi.unstubAllEnvs()
})

const TOKEN = 'cf-token'

const LOOKUPS: ReadonlyArray<DnsRecordLookup> = [
	{
		zoneName: 'example.com',
		name: 'app.example.com',
	},
]

describe('deleteDnsRecordsByName', () => {
	it('returns 0 when given an empty records array', async () => {
		vi.stubEnv('LOG_LEVEL', 'silent')
		const count = await deleteDnsRecordsByName([], TOKEN)
		expect(count).toBe(0)
	})

	it('finds and deletes matching DNS records', async () => {
		vi.stubEnv('LOG_LEVEL', 'silent')
		const deletedIds: string[] = []

		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)

			// Zone lookup
			if (url.includes('/zones?name=') && method === 'GET') {
				return Promise.resolve(
					okJson({
						success: true,
						result: [{ id: 'zone-1' }],
						errors: [],
					}),
				)
			}
			// List DNS records
			if (url.includes('/dns_records?') && method === 'GET') {
				return Promise.resolve(
					okJson({
						success: true,
						result: [
							{
								id: 'rec-1',
								type: 'A',
								name: 'app.example.com',
								content: '1.2.3.4',
								proxied: true,
								ttl: 1,
							},
						],
						errors: [],
					}),
				)
			}
			// Delete DNS record
			if (url.includes('/dns_records/') && method === 'DELETE') {
				const id = url.split('/dns_records/')[1]!
				deletedIds.push(id)
				return Promise.resolve(okJson({ success: true, errors: [] }))
			}

			throw new Error(`Unexpected call: ${method} ${url}`)
		}

		vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))

		const count = await deleteDnsRecordsByName(LOOKUPS, TOKEN)

		expect(count).toBe(1)
		expect(deletedIds).toEqual(['rec-1'])
	})

	it('returns 0 when no existing records match', async () => {
		vi.stubEnv('LOG_LEVEL', 'silent')

		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)

			if (url.includes('/zones?name=') && method === 'GET') {
				return Promise.resolve(
					okJson({
						success: true,
						result: [{ id: 'zone-1' }],
						errors: [],
					}),
				)
			}
			if (url.includes('/dns_records?') && method === 'GET') {
				return Promise.resolve(
					okJson({ success: true, result: [], errors: [] }),
				)
			}

			throw new Error(`Unexpected call: ${method} ${url}`)
		}

		vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))

		const count = await deleteDnsRecordsByName(LOOKUPS, TOKEN)

		expect(count).toBe(0)
	})

	it('handles multiple records across multiple zones', async () => {
		vi.stubEnv('LOG_LEVEL', 'silent')
		const deletedIds: string[] = []

		const multiLookups: ReadonlyArray<DnsRecordLookup> = [
			{
				zoneName: 'example.com',
				name: 'app.example.com',
			},
			{
				zoneName: 'other.io',
				name: 'app.other.io',
			},
		]

		const impl: FetchImpl = (input, init) => {
			const url = urlOf(input)
			const method = methodOf(init)

			if (url.includes('/zones?name=example.com') && method === 'GET') {
				return Promise.resolve(
					okJson({
						success: true,
						result: [{ id: 'zone-ex' }],
						errors: [],
					}),
				)
			}
			if (url.includes('/zones?name=other.io') && method === 'GET') {
				return Promise.resolve(
					okJson({
						success: true,
						result: [{ id: 'zone-ot' }],
						errors: [],
					}),
				)
			}
			if (url.includes('/dns_records?') && method === 'GET') {
				if (url.includes('zone-ex')) {
					return Promise.resolve(
						okJson({
							success: true,
							result: [
								{
									id: 'rec-a',
									type: 'A',
									name: 'app.example.com',
									content: '1.2.3.4',
									proxied: true,
									ttl: 1,
								},
							],
							errors: [],
						}),
					)
				}
				return Promise.resolve(
					okJson({
						success: true,
						result: [
							{
								id: 'rec-b',
								type: 'CNAME',
								name: 'app.other.io',
								content: 'target.pages.dev',
								proxied: true,
								ttl: 1,
							},
						],
						errors: [],
					}),
				)
			}
			if (url.includes('/dns_records/') && method === 'DELETE') {
				const id = url.split('/dns_records/')[1]!
				deletedIds.push(id)
				return Promise.resolve(okJson({ success: true, errors: [] }))
			}

			throw new Error(`Unexpected call: ${method} ${url}`)
		}

		vi.stubGlobal('fetch', vi.fn<FetchImpl>(impl))

		const count = await deleteDnsRecordsByName(multiLookups, TOKEN)

		expect(count).toBe(2)
		expect(deletedIds).toContain('rec-a')
		expect(deletedIds).toContain('rec-b')
	})
})
