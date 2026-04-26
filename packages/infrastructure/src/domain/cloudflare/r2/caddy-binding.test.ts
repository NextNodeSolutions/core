import { describe, expect, it } from 'vitest'

import { buildR2CaddyBinding } from './caddy-binding.ts'
import type { InfraStorageRuntimeConfig } from './runtime-config.ts'

const R2: InfraStorageRuntimeConfig = {
	accountId: 'acct',
	endpoint: 'https://acct.r2.cloudflarestorage.com',
	accessKeyId: 'key',
	secretAccessKey: 'secret',
	stateBucket: 'state',
	certsBucket: 'certs',
}

describe('buildR2CaddyBinding', () => {
	it('derives an account-scoped host from the R2 runtime', () => {
		const binding = buildR2CaddyBinding(R2, 'acme-web')
		expect(binding.host).toBe('acct.r2.cloudflarestorage.com')
	})

	it('points at the certs bucket and the project key prefix', () => {
		const binding = buildR2CaddyBinding(R2, 'acme-web')
		expect(binding.bucket).toBe('certs')
		expect(binding.prefix).toBe('acme-web/')
	})

	it('exposes only the access key id, never the secret', () => {
		const binding = buildR2CaddyBinding(R2, 'acme-web')
		expect(binding.accessKeyId).toBe('key')
		expect(Object.values(binding)).not.toContain('secret')
	})
})
