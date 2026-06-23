import { describe, expect, it } from 'vitest'

import { computeVpsDnsRecords } from './dns-records.ts'

describe('computeVpsDnsRecords', () => {
	describe('production', () => {
		it('returns a proxied A record for the bare domain', () => {
			const records = computeVpsDnsRecords({
				internal: false,
				domain: 'acme.example.com',
				environment: 'production',
				publicIp: '178.104.174.209',
				tailnetIp: '100.64.0.1',
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
				internal: false,
				domain: 'example.com',
				environment: 'production',
				publicIp: '1.2.3.4',
				tailnetIp: '100.64.0.1',
			})

			expect(records[0]?.ttl).toBe(1)
		})

		it('keeps an apex domain proxied (covered by Universal SSL)', () => {
			const records = computeVpsDnsRecords({
				internal: false,
				domain: 'example.com',
				environment: 'production',
				publicIp: '1.2.3.4',
				tailnetIp: '100.64.0.1',
			})

			expect(records[0]?.proxied).toBe(true)
		})

		it('keeps a one-label service subdomain proxied (covered by *.zone)', () => {
			const records = computeVpsDnsRecords({
				internal: false,
				domain: 'fleurs.nextnode.fr',
				environment: 'production',
				publicIp: '1.2.3.4',
				tailnetIp: '100.64.0.1',
			})

			expect(records[0]?.proxied).toBe(true)
		})

		it('grey-clouds a two-label service subdomain Universal SSL cannot cover', () => {
			// admin.fleurs.nextnode.fr is two labels below the apex nextnode.fr,
			// so the free `*.nextnode.fr` edge cert does not cover it. A proxied
			// record would fail the client<->Cloudflare TLS handshake; the record
			// must be DNS-only so Caddy's origin certificate serves it directly.
			const records = computeVpsDnsRecords({
				internal: false,
				domain: 'admin.fleurs.nextnode.fr',
				environment: 'production',
				publicIp: '1.2.3.4',
				tailnetIp: '100.64.0.1',
			})

			expect(records).toEqual([
				{
					zoneName: 'nextnode.fr',
					name: 'admin.fleurs.nextnode.fr',
					type: 'A',
					content: '1.2.3.4',
					proxied: false,
					ttl: 300,
				},
			])
		})
	})

	describe('development', () => {
		it('returns an unproxied A record for dev.{domain}', () => {
			const records = computeVpsDnsRecords({
				internal: false,
				domain: 'acme.example.com',
				environment: 'development',
				publicIp: '178.104.174.209',
				tailnetIp: '100.64.0.1',
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
				internal: false,
				domain: 'example.com',
				environment: 'development',
				publicIp: '1.2.3.4',
				tailnetIp: '100.64.0.1',
			})

			expect(records[0]?.ttl).toBe(300)
		})
	})

	it('always returns exactly one record', () => {
		const records = computeVpsDnsRecords({
			internal: false,
			domain: 'example.com',
			environment: 'production',
			publicIp: '1.2.3.4',
			tailnetIp: '100.64.0.1',
		})

		expect(records).toHaveLength(1)
	})

	it('extracts the root domain for the zone name', () => {
		const records = computeVpsDnsRecords({
			internal: false,
			domain: 'deep.sub.example.com',
			environment: 'production',
			publicIp: '1.2.3.4',
			tailnetIp: '100.64.0.1',
		})

		expect(records[0]?.zoneName).toBe('example.com')
	})

	describe('internal', () => {
		it('points to tailnet IP instead of public IP', () => {
			const records = computeVpsDnsRecords({
				internal: true,
				domain: 'monitor.nextnode.fr',
				environment: 'production',
				publicIp: '178.104.174.209',
				tailnetIp: '100.64.0.5',
			})

			expect(records[0]?.content).toBe('100.64.0.5')
		})

		it('is never proxied regardless of environment', () => {
			for (const environment of ['production', 'development'] as const) {
				const records = computeVpsDnsRecords({
					internal: true,
					domain: 'monitor.nextnode.fr',
					environment,
					publicIp: '178.104.174.209',
					tailnetIp: '100.64.0.5',
				})

				expect(records[0]?.proxied).toBe(false)
			}
		})

		it('uses TTL=300 for all internal records', () => {
			const records = computeVpsDnsRecords({
				internal: true,
				domain: 'monitor.nextnode.fr',
				environment: 'production',
				publicIp: '178.104.174.209',
				tailnetIp: '100.64.0.5',
			})

			expect(records[0]?.ttl).toBe(300)
		})

		it('applies dev subdomain prefix for development', () => {
			const records = computeVpsDnsRecords({
				internal: true,
				domain: 'monitor.nextnode.fr',
				environment: 'development',
				publicIp: '178.104.174.209',
				tailnetIp: '100.64.0.5',
			})

			expect(records[0]?.name).toBe('dev.monitor.nextnode.fr')
		})
	})
})
