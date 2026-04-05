import { describe, expect, it } from 'vitest'

import {
	computePagesDomains,
	findStalePagesDomains,
	reconcilePagesDomain,
} from './pages-domains.ts'

describe('computePagesDomains', () => {
	describe('production', () => {
		it('returns the root domain when no redirects are configured', () => {
			const domains = computePagesDomains({
				domain: 'example.com',
				redirectDomains: [],
				environment: 'production',
			})

			expect(domains).toEqual([{ name: 'example.com' }])
		})

		it('appends one entry per redirect_domain, preserving order', () => {
			const domains = computePagesDomains({
				domain: 'example.com',
				redirectDomains: ['example.fr', 'example.net'],
				environment: 'production',
			})

			expect(domains).toEqual([
				{ name: 'example.com' },
				{ name: 'example.fr' },
				{ name: 'example.net' },
			])
		})
	})

	describe('development', () => {
		it('returns a single dev.{domain} entry', () => {
			const domains = computePagesDomains({
				domain: 'example.com',
				redirectDomains: [],
				environment: 'development',
			})

			expect(domains).toEqual([{ name: 'dev.example.com' }])
		})

		it('ignores redirect_domains in development', () => {
			const domains = computePagesDomains({
				domain: 'example.com',
				redirectDomains: ['example.fr', 'example.net'],
				environment: 'development',
			})

			expect(domains).toEqual([{ name: 'dev.example.com' }])
		})
	})
})

describe('reconcilePagesDomain', () => {
	it('returns attach when the domain is not attached', () => {
		expect(reconcilePagesDomain({ name: 'example.com' }, [])).toEqual({
			kind: 'attach',
		})
	})

	it('returns skip when the domain is already attached', () => {
		expect(
			reconcilePagesDomain({ name: 'example.com' }, [
				{ name: 'example.com' },
			]),
		).toEqual({ kind: 'skip' })
	})

	it('matches by name across a list of attached domains', () => {
		expect(
			reconcilePagesDomain({ name: 'example.com' }, [
				{ name: 'other.com' },
				{ name: 'example.com' },
			]),
		).toEqual({ kind: 'skip' })
	})

	it('is case-sensitive (only exact-name matches skip)', () => {
		expect(
			reconcilePagesDomain({ name: 'example.com' }, [
				{ name: 'Example.com' },
			]),
		).toEqual({ kind: 'attach' })
	})
})

describe('findStalePagesDomains', () => {
	it('returns an empty list when attached matches desired exactly', () => {
		expect(
			findStalePagesDomains(
				[{ name: 'example.com' }],
				[{ name: 'example.com' }],
			),
		).toEqual([])
	})

	it('returns attached domains that are not in desired', () => {
		expect(
			findStalePagesDomains(
				[{ name: 'example.com' }],
				[
					{ name: 'example.com' },
					{ name: 'old.example.com' },
					{ name: 'legacy.example.com' },
				],
			),
		).toEqual([{ name: 'old.example.com' }, { name: 'legacy.example.com' }])
	})

	it('returns an empty list when no domain is attached', () => {
		expect(findStalePagesDomains([{ name: 'example.com' }], [])).toEqual([])
	})

	it('returns all attached when desired is empty', () => {
		expect(
			findStalePagesDomains([], [{ name: 'a.com' }, { name: 'b.com' }]),
		).toEqual([{ name: 'a.com' }, { name: 'b.com' }])
	})
})
