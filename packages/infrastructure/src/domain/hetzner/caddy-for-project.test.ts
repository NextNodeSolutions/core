import { describe, expect, it } from 'vitest'

import type { ObjectStorageBinding } from '@/domain/storage/binding.ts'

import { buildCaddyForProject } from './caddy-for-project.ts'

const STORAGE: ObjectStorageBinding = {
	host: 'acct.r2.cloudflarestorage.com',
	bucket: 'certs',
	accessKeyId: 'key',
	prefix: 'acme-web/',
}

describe('buildCaddyForProject', () => {
	it('threads the storage binding into the Caddy s3 module', () => {
		const config = buildCaddyForProject({
			internal: false,
			storage: STORAGE,
			upstreams: [],
			acmeEmail: 'test@example.com',
		})

		const storage = config.apps.tls.automation.policies[0]?.storage
		expect(storage).toEqual({
			module: 's3',
			host: 'acct.r2.cloudflarestorage.com',
			bucket: 'certs',
			access_id: 'key',
			secret_key: '{env.CADDY_R2_SECRET_KEY}',
			prefix: 'acme-web/',
		})
	})

	it('routes secrets through env placeholders, never inlining raw values', () => {
		const config = buildCaddyForProject({
			internal: false,
			storage: STORAGE,
			upstreams: [],
			acmeEmail: 'test@example.com',
		})

		const serialized = JSON.stringify(config)
		expect(serialized).toContain('{env.CADDY_R2_SECRET_KEY}')
		expect(serialized).not.toContain('"secret_key": "key"')
	})

	it('threads acmeEmail into issuers', () => {
		const config = buildCaddyForProject({
			internal: false,
			storage: STORAGE,
			upstreams: [
				{ hostname: 'acme.example.com', dial: 'localhost:8080' },
			],
			acmeEmail: 'infra@nextnode.fr',
		})

		const issuers = config.apps.tls.automation.policies[0]?.issuers
		expect(issuers).toStrictEqual([
			{ module: 'acme', email: 'infra@nextnode.fr' },
		])
	})

	it('maps upstream routes verbatim', () => {
		const config = buildCaddyForProject({
			internal: false,
			storage: STORAGE,
			upstreams: [
				{ hostname: 'acme.example.com', dial: 'localhost:8080' },
			],
			acmeEmail: 'test@example.com',
		})

		expect(config.apps.http.servers.https.routes).toHaveLength(1)
		expect(config.apps.http.servers.https.routes[0]?.match).toEqual([
			{ host: ['acme.example.com'] },
		])
	})

	it('uses DNS-01 challenge for internal projects with env placeholder for CF token', () => {
		const config = buildCaddyForProject({
			internal: true,
			storage: STORAGE,
			upstreams: [
				{ hostname: 'monitor.nextnode.fr', dial: 'localhost:8080' },
			],
			acmeEmail: 'infra@nextnode.fr',
		})

		const issuer = config.apps.tls.automation.policies[0]?.issuers[0]
		if (!issuer || issuer.module !== 'acme')
			throw new Error('Expected ACME issuer')
		expect(issuer.challenges?.dns?.provider).toStrictEqual({
			name: 'cloudflare',
			api_token: '{env.CF_DNS_API_TOKEN}',
		})
		expect(issuer.challenges?.http).toStrictEqual({ disabled: true })
	})

	it('routes both R2 + CF tokens through env placeholders for internal projects', () => {
		const config = buildCaddyForProject({
			internal: true,
			storage: STORAGE,
			upstreams: [],
			acmeEmail: 'infra@nextnode.fr',
		})

		const serialized = JSON.stringify(config)
		expect(serialized).toContain('{env.CF_DNS_API_TOKEN}')
		expect(serialized).toContain('{env.CADDY_R2_SECRET_KEY}')
	})

	it('preserves the storage binding for internal projects', () => {
		const config = buildCaddyForProject({
			internal: true,
			storage: { ...STORAGE, prefix: 'monitor/' },
			upstreams: [],
			acmeEmail: 'infra@nextnode.fr',
		})

		const storage = config.apps.tls.automation.policies[0]?.storage
		expect(storage?.module).toBe('s3')
		expect(storage?.prefix).toBe('monitor/')
	})
})
