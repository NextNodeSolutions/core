import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hashToken, verifyToken } from '../domain/token.ts'

import type { TokenStore } from './token-store.ts'
import { openTokenStore } from './token-store.ts'

describe('openTokenStore (integration)', () => {
	let tempDir: string
	let store: TokenStore

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'nn-monitor-token-store-'))
		store = openTokenStore(join(tempDir, 'tokens.db'))
	})

	afterEach(() => {
		store.close()
		rmSync(tempDir, { recursive: true, force: true })
	})

	describe('create', () => {
		it('returns a tenant with derived rate limit and a verifiable plaintext', () => {
			const { tenant, plaintext } = store.create({
				clientId: 'acme',
				project: 'shop',
				tier: 'standard',
			})

			expect(tenant.clientId).toBe('acme')
			expect(tenant.project).toBe('shop')
			expect(tenant.tier).toBe('standard')
			expect(tenant.rateLimitRpm).toBe(60)
			expect(tenant.revokedAt).toBeNull()
			expect(plaintext.startsWith('nn_live_')).toBe(true)
		})

		it('persists the tenant so findByHash can recover it', () => {
			const { tenant, plaintext } = store.create({
				clientId: 'acme',
				project: 'api',
				tier: 'enterprise',
			})

			const found = store.findByHash(hashToken(plaintext))

			expect(found).not.toBeNull()
			expect(found?.id).toBe(tenant.id)
			expect(found?.rateLimitRpm).toBe(600)
		})

		it('generates distinct ids and tokens for consecutive creates', () => {
			const a = store.create({
				clientId: 'acme',
				project: 'api',
				tier: 'standard',
			})
			const b = store.create({
				clientId: 'acme',
				project: 'api',
				tier: 'standard',
			})

			expect(a.tenant.id).not.toBe(b.tenant.id)
			expect(a.plaintext).not.toBe(b.plaintext)
		})
	})

	describe('findByHash', () => {
		it('returns null when no token matches', () => {
			expect(store.findByHash(hashToken('nn_live_unknown'))).toBeNull()
		})

		it('returns null for a hash belonging to a revoked tenant', () => {
			const { tenant, plaintext } = store.create({
				clientId: 'acme',
				project: 'api',
				tier: 'standard',
			})
			store.revoke(tenant.id)

			expect(store.findByHash(hashToken(plaintext))).toBeNull()
		})

		it('verifies the plaintext matches the stored hash', () => {
			const { plaintext } = store.create({
				clientId: 'acme',
				project: 'api',
				tier: 'standard',
			})
			const found = store.findByHash(hashToken(plaintext))

			expect(found).not.toBeNull()
			expect(verifyToken(plaintext, hashToken(plaintext))).toBe(true)
		})
	})

	describe('list', () => {
		it('returns an empty array when no tenants exist', () => {
			expect(store.list()).toEqual([])
		})

		it('returns only active tenants by default', () => {
			const a = store.create({
				clientId: 'acme',
				project: 'api',
				tier: 'standard',
			})
			store.create({
				clientId: 'globex',
				project: 'web',
				tier: 'enterprise',
			})
			store.revoke(a.tenant.id)

			const tenants = store.list()
			expect(tenants).toHaveLength(1)
			expect(tenants[0]?.clientId).toBe('globex')
		})

		it('includes revoked tenants when includeRevoked is true', () => {
			const a = store.create({
				clientId: 'acme',
				project: 'api',
				tier: 'standard',
			})
			store.create({
				clientId: 'globex',
				project: 'web',
				tier: 'enterprise',
			})
			store.revoke(a.tenant.id)

			const tenants = store.list({ includeRevoked: true })
			expect(tenants).toHaveLength(2)
			const acme = tenants.find(t => t.clientId === 'acme')
			expect(acme?.revokedAt).toBeInstanceOf(Date)
		})

		it('orders results by createdAt ascending', () => {
			const first = store.create({
				clientId: 'a',
				project: 'p',
				tier: 'standard',
			})
			const second = store.create({
				clientId: 'b',
				project: 'p',
				tier: 'standard',
			})

			const tenants = store.list()
			expect(tenants.map(t => t.id)).toEqual([
				first.tenant.id,
				second.tenant.id,
			])
		})
	})

	describe('revoke', () => {
		it('marks the tenant as revoked and returns true', () => {
			const { tenant } = store.create({
				clientId: 'acme',
				project: 'api',
				tier: 'standard',
			})

			expect(store.revoke(tenant.id)).toBe(true)
			const reloaded = store.findById(tenant.id)
			expect(reloaded?.revokedAt).toBeInstanceOf(Date)
		})

		it('returns false when revoking an already-revoked tenant', () => {
			const { tenant } = store.create({
				clientId: 'acme',
				project: 'api',
				tier: 'standard',
			})
			store.revoke(tenant.id)

			expect(store.revoke(tenant.id)).toBe(false)
		})

		it('returns false when the tenant does not exist', () => {
			expect(store.revoke('missing-id')).toBe(false)
		})
	})

	describe('rotate', () => {
		it('atomically revokes the old tenant and creates a new one with matching metadata', () => {
			const original = store.create({
				clientId: 'acme',
				project: 'api',
				tier: 'enterprise',
			})

			const rotated = store.rotate(original.tenant.id)

			expect(rotated.tenant.id).not.toBe(original.tenant.id)
			expect(rotated.tenant.clientId).toBe('acme')
			expect(rotated.tenant.project).toBe('api')
			expect(rotated.tenant.tier).toBe('enterprise')
			expect(rotated.tenant.rateLimitRpm).toBe(600)
			expect(rotated.plaintext).not.toBe(original.plaintext)

			const oldReloaded = store.findById(original.tenant.id)
			expect(oldReloaded?.revokedAt).toBeInstanceOf(Date)

			expect(store.findByHash(hashToken(original.plaintext))).toBeNull()
			expect(store.findByHash(hashToken(rotated.plaintext))?.id).toBe(
				rotated.tenant.id,
			)
		})

		it('throws when the tenant does not exist', () => {
			expect(() => store.rotate('missing-id')).toThrow(
				'tenant missing-id not found — cannot rotate',
			)
		})

		it('throws when the tenant is already revoked', () => {
			const { tenant } = store.create({
				clientId: 'acme',
				project: 'api',
				tier: 'standard',
			})
			store.revoke(tenant.id)

			expect(() => store.rotate(tenant.id)).toThrow(
				`tenant ${tenant.id} already revoked — cannot rotate`,
			)
		})
	})

	describe('persistence', () => {
		it('survives reopening the database file', () => {
			const dbPath = join(tempDir, 'persist.db')
			const first = openTokenStore(dbPath)
			const { plaintext } = first.create({
				clientId: 'acme',
				project: 'api',
				tier: 'standard',
			})
			first.close()

			const second = openTokenStore(dbPath)
			const found = second.findByHash(hashToken(plaintext))
			second.close()

			expect(found).not.toBeNull()
			expect(found?.clientId).toBe('acme')
		})
	})
})
