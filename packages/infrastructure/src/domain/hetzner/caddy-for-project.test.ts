import { describe, expect, it } from 'vitest'

import type { R2RuntimeConfig } from '../cloudflare/r2/runtime-config.ts'

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
	it('binds the R2 storage block to the project prefix', () => {
		const config = buildCaddyForProject({
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
			secret_key: 'secret',
			prefix: 'acme-web/',
		})
	})

	it('threads acmeEmail into issuers', () => {
		const config = buildCaddyForProject({
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
})
