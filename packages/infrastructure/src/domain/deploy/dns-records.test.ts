import { describe, expect, it } from 'vitest'

import type { DesiredDnsRecord } from './dns-records.ts'
import {
	computeDnsRecords,
	extractRootDomain,
	reconcileDnsRecord,
} from './dns-records.ts'

describe('computeDnsRecords', () => {
	describe('production', () => {
		it('returns root CNAME proxied with TTL=1', () => {
			const records = computeDnsRecords({
				domain: 'example.com',
				redirectDomains: [],
				environment: 'production',
				projectName: 'my-site',
			})

			expect(records).toEqual([
				{
					zoneName: 'example.com',
					name: 'example.com',
					type: 'CNAME',
					content: 'my-site.pages.dev',
					proxied: true,
					ttl: 1,
				},
			])
		})

		it('appends a proxied CNAME for every redirect_domain', () => {
			const records = computeDnsRecords({
				domain: 'example.com',
				redirectDomains: ['example.fr', 'example.net'],
				environment: 'production',
				projectName: 'my-site',
			})

			expect(records).toHaveLength(3)
			expect(records[0]?.name).toBe('example.com')
			expect(records[1]).toEqual({
				zoneName: 'example.fr',
				name: 'example.fr',
				type: 'CNAME',
				content: 'my-site.pages.dev',
				proxied: true,
				ttl: 1,
			})
			expect(records[2]).toEqual({
				zoneName: 'example.net',
				name: 'example.net',
				type: 'CNAME',
				content: 'my-site.pages.dev',
				proxied: true,
				ttl: 1,
			})
		})

		it('targets the correct Pages project name', () => {
			const records = computeDnsRecords({
				domain: 'example.com',
				redirectDomains: [],
				environment: 'production',
				projectName: 'blog',
			})

			expect(records[0]?.content).toBe('blog.pages.dev')
		})
	})

	describe('development', () => {
		it('returns dev.{domain} CNAME unproxied with TTL=300', () => {
			const records = computeDnsRecords({
				domain: 'example.com',
				redirectDomains: [],
				environment: 'development',
				projectName: 'my-site',
			})

			expect(records).toEqual([
				{
					zoneName: 'example.com',
					name: 'dev.example.com',
					type: 'CNAME',
					content: 'my-site.pages.dev',
					proxied: false,
					ttl: 300,
				},
			])
		})

		it('ignores redirect_domains in development', () => {
			const records = computeDnsRecords({
				domain: 'example.com',
				redirectDomains: ['example.fr', 'example.net'],
				environment: 'development',
				projectName: 'my-site',
			})

			expect(records).toHaveLength(1)
			expect(records[0]?.name).toBe('dev.example.com')
		})
	})
})

describe('reconcileDnsRecord', () => {
	const desired: DesiredDnsRecord = {
		zoneName: 'example.com',
		name: 'example.com',
		type: 'CNAME',
		content: 'my-site.pages.dev',
		proxied: true,
		ttl: 1,
	}

	it('returns create when no existing record matches', () => {
		expect(reconcileDnsRecord(desired, [])).toEqual({ kind: 'create' })
	})

	it('returns skip when the existing record matches exactly', () => {
		expect(
			reconcileDnsRecord(desired, [
				{
					id: 'rec-1',
					content: 'my-site.pages.dev',
					proxied: true,
					ttl: 1,
				},
			]),
		).toEqual({ kind: 'skip' })
	})

	it('returns update when content differs', () => {
		expect(
			reconcileDnsRecord(desired, [
				{
					id: 'rec-1',
					content: 'other.pages.dev',
					proxied: true,
					ttl: 1,
				},
			]),
		).toEqual({ kind: 'update', recordId: 'rec-1' })
	})

	it('returns update when proxied differs', () => {
		expect(
			reconcileDnsRecord(desired, [
				{
					id: 'rec-1',
					content: 'my-site.pages.dev',
					proxied: false,
					ttl: 1,
				},
			]),
		).toEqual({ kind: 'update', recordId: 'rec-1' })
	})

	it('returns update when ttl differs', () => {
		expect(
			reconcileDnsRecord(desired, [
				{
					id: 'rec-1',
					content: 'my-site.pages.dev',
					proxied: true,
					ttl: 300,
				},
			]),
		).toEqual({ kind: 'update', recordId: 'rec-1' })
	})

	it('compares against the first existing record when multiple are returned', () => {
		expect(
			reconcileDnsRecord(desired, [
				{
					id: 'rec-first',
					content: 'stale.pages.dev',
					proxied: true,
					ttl: 1,
				},
				{
					id: 'rec-second',
					content: 'my-site.pages.dev',
					proxied: true,
					ttl: 1,
				},
			]),
		).toEqual({ kind: 'update', recordId: 'rec-first' })
	})
})

describe('extractRootDomain', () => {
	it('returns the input when it is already a root domain', () => {
		expect(extractRootDomain('example.com')).toBe('example.com')
	})

	it('strips the subdomain', () => {
		expect(extractRootDomain('dev.example.com')).toBe('example.com')
	})

	it('handles multi-level subdomains', () => {
		expect(extractRootDomain('a.b.example.com')).toBe('example.com')
	})

	it('returns the input unchanged when it has no dot', () => {
		expect(extractRootDomain('localhost')).toBe('localhost')
	})
})
