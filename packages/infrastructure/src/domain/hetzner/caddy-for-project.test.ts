import { describe, expect, it } from 'vitest'

import type { R2RuntimeConfig } from '@/domain/cloudflare/r2/runtime-config.ts'

import { buildCaddyForProject } from './caddy-for-project.ts'

const R2: R2RuntimeConfig = {
	accountId: 'acct',
	endpoint: 'https://r2.example.com',
	accessKeyId: 'key',
	secretAccessKey: 'secret',
	stateBucket: 'state',
	certsBucket: 'certs',
}

describe('buildCaddyForProject', () => {
	it('binds the R2 storage block to the project prefix and uses env placeholder for secret_key', () => {
		const config = buildCaddyForProject({
			internal: false,
			projectName: 'acme-web',
			r2: R2,
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

	it('never embeds the raw R2 secret access key in the JSON config', () => {
		const config = buildCaddyForProject({
			internal: false,
			projectName: 'acme-web',
			r2: { ...R2, secretAccessKey: 'VERY_SECRET_VALUE' },
			upstreams: [],
			acmeEmail: 'test@example.com',
		})

		expect(JSON.stringify(config)).not.toContain('VERY_SECRET_VALUE')
	})

	it('threads acmeEmail into issuers', () => {
		const config = buildCaddyForProject({
			internal: false,
			projectName: 'acme-web',
			r2: R2,
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
			projectName: 'acme-web',
			r2: R2,
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
			projectName: 'monitor',
			r2: R2,
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

	it('never embeds the raw Cloudflare API token in the internal JSON config', () => {
		const config = buildCaddyForProject({
			internal: true,
			projectName: 'monitor',
			r2: R2,
			upstreams: [],
			acmeEmail: 'infra@nextnode.fr',
		})

		const serialized = JSON.stringify(config)
		expect(serialized).toContain('{env.CF_DNS_API_TOKEN}')
		expect(serialized).toContain('{env.CADDY_R2_SECRET_KEY}')
	})

	it('stores certs in R2 for internal projects', () => {
		const config = buildCaddyForProject({
			internal: true,
			projectName: 'monitor',
			r2: R2,
			upstreams: [],
			acmeEmail: 'infra@nextnode.fr',
		})

		const storage = config.apps.tls.automation.policies[0]?.storage
		expect(storage?.module).toBe('s3')
		expect(storage?.prefix).toBe('monitor/')
	})
})
