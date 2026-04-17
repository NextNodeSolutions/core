import { describe, expect, it } from 'vitest'

import { computeVpsDnsRecords } from './dns-records.ts'

describe('computeVpsDnsRecords', () => {
	describe('production', () => {
		it('returns a proxied A record for the bare domain', () => {
			const records = computeVpsDnsRecords({
				domain: 'acme.example.com',
				environment: 'production',
				publicIp: '178.104.174.209',
			})

			expect(records).toEqual([
				{
					zoneName: 'example.com',
					name: 'acme.example.com',
					type: 'A',
					content: '178.104.174.209',
					proxied: true,
					ttl: 1,
				},
			])
		})

		it('uses TTL=1 for proxied records (Cloudflare auto)', () => {
			const records = computeVpsDnsRecords({
				domain: 'example.com',
				environment: 'production',
				publicIp: '1.2.3.4',
			})

			expect(records[0]?.ttl).toBe(1)
		})
	})

	describe('development', () => {
		it('returns an unproxied A record for dev.{domain}', () => {
			const records = computeVpsDnsRecords({
				domain: 'acme.example.com',
				environment: 'development',
				publicIp: '178.104.174.209',
			})

			expect(records).toEqual([
				{
					zoneName: 'example.com',
					name: 'dev.acme.example.com',
					type: 'A',
					content: '178.104.174.209',
					proxied: false,
					ttl: 300,
				},
			])
		})

		it('uses TTL=300 for unproxied records', () => {
			const records = computeVpsDnsRecords({
				domain: 'example.com',
				environment: 'development',
				publicIp: '1.2.3.4',
			})

			expect(records[0]?.ttl).toBe(300)
		})
	})

	it('always returns exactly one record', () => {
		const records = computeVpsDnsRecords({
			domain: 'example.com',
			environment: 'production',
			publicIp: '1.2.3.4',
		})

		expect(records).toHaveLength(1)
	})

	it('extracts the root domain for the zone name', () => {
		const records = computeVpsDnsRecords({
			domain: 'deep.sub.example.com',
			environment: 'production',
			publicIp: '1.2.3.4',
		})

		expect(records[0]?.zoneName).toBe('example.com')
	})
})
