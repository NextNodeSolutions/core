import { describe, expect, it } from 'vitest'

import type { CaddyConfigInput, CaddyRoute } from './config.ts'
import {
	buildCaddyConfig,
	buildDnsAcmeIssuer,
	buildPublicAcmeIssuer,
	buildUpstreamRoute,
	extractUpstreams,
} from './config.ts'

const STORAGE_BINDING = {
	host: 'abc123.r2.cloudflarestorage.com',
	bucket: 'nextnode-certs',
	accessKeyId: 'R2_ACCESS_KEY',
	prefix: 'certs',
} as const

function makeInput(
	overrides: Partial<CaddyConfigInput> = {},
): CaddyConfigInput {
	return {
		routes: [],
		subjects: [],
		storage: STORAGE_BINDING,
		issuer: buildPublicAcmeIssuer('test@example.com'),
		...overrides,
	}
}

describe('buildUpstreamRoute', () => {
	it('builds a terminal reverse_proxy route from an upstream', () => {
		const route = buildUpstreamRoute({
			hostname: 'acme.example.com',
			dial: '127.0.0.1:8080',
		})

		expect(route).toStrictEqual({
			match: [{ host: ['acme.example.com'] }],
			handle: [
				{
					handler: 'reverse_proxy',
					upstreams: [{ dial: '127.0.0.1:8080' }],
				},
			],
			terminal: true,
		})
	})
})

describe('buildPublicAcmeIssuer', () => {
	it('returns an ACME issuer with the email and no challenge overrides', () => {
		expect(buildPublicAcmeIssuer('infra@nextnode.fr')).toStrictEqual({
			module: 'acme',
			email: 'infra@nextnode.fr',
		})
	})
})

describe('buildDnsAcmeIssuer', () => {
	it('disables HTTP-01 and TLS-ALPN and routes DNS-01 through Cloudflare', () => {
		expect(buildDnsAcmeIssuer('infra@nextnode.fr')).toStrictEqual({
			module: 'acme',
			email: 'infra@nextnode.fr',
			challenges: {
				http: { disabled: true },
				'tls-alpn': { disabled: true },
				dns: {
					provider: {
						name: 'cloudflare',
						api_token: '{env.CF_DNS_API_TOKEN}',
					},
				},
			},
		})
	})

	it('routes the CF API token through an env placeholder, not the literal', () => {
		const issuer = buildDnsAcmeIssuer('infra@nextnode.fr')
		const apiToken = issuer.challenges?.dns?.provider.api_token
		expect(apiToken).toBe('{env.CF_DNS_API_TOKEN}')
	})
})

describe('buildCaddyConfig', () => {
	it('listens on :443', () => {
		const config = buildCaddyConfig(makeInput())
		expect(config.apps.http.servers.https.listen).toStrictEqual([':443'])
	})

	it('passes routes through verbatim', () => {
		const routes: ReadonlyArray<CaddyRoute> = [
			buildUpstreamRoute({
				hostname: 'acme.example.com',
				dial: '127.0.0.1:8080',
			}),
			buildUpstreamRoute({
				hostname: 'dev.acme.example.com',
				dial: '127.0.0.1:8081',
			}),
		]
		const config = buildCaddyConfig(makeInput({ routes }))
		expect(config.apps.http.servers.https.routes).toStrictEqual(routes)
	})

	it('passes subjects through verbatim into the TLS automation policy', () => {
		const subjects = ['acme.example.com', 'dev.acme.example.com']
		const config = buildCaddyConfig(makeInput({ subjects }))
		expect(config.apps.tls.automation.policies[0]?.subjects).toStrictEqual(
			subjects,
		)
	})

	it('wraps the provided issuer into the TLS automation policy', () => {
		const issuer = buildPublicAcmeIssuer('test@example.com')
		const config = buildCaddyConfig(makeInput({ issuer }))
		expect(config.apps.tls.automation.policies[0]?.issuers).toStrictEqual([
			issuer,
		])
	})

	it('accepts a DNS-01 issuer just as well as the public one', () => {
		const issuer = buildDnsAcmeIssuer('test@example.com')
		const config = buildCaddyConfig(makeInput({ issuer }))
		expect(config.apps.tls.automation.policies[0]?.issuers).toStrictEqual([
			issuer,
		])
	})

	it('configures R2 storage via caddy-storage-s3 with the secret as env placeholder', () => {
		const config = buildCaddyConfig(makeInput())
		expect(config.apps.tls.automation.policies[0]?.storage).toStrictEqual({
			module: 's3',
			host: 'abc123.r2.cloudflarestorage.com',
			bucket: 'nextnode-certs',
			access_id: 'R2_ACCESS_KEY',
			secret_key: '{env.CADDY_R2_SECRET_KEY}',
			prefix: 'certs',
		})
	})

	it('produces valid JSON for the Caddy /load endpoint', () => {
		const config = buildCaddyConfig(makeInput())
		expect(() => JSON.parse(JSON.stringify(config))).not.toThrow()
	})
})

describe('extractUpstreams', () => {
	it('round-trips a single-upstream config', () => {
		const upstreams = [
			{ hostname: 'acme.example.com', dial: '127.0.0.1:8080' },
		]
		const routes = upstreams.map(buildUpstreamRoute)
		const json = JSON.stringify(
			buildCaddyConfig(
				makeInput({
					routes,
					subjects: upstreams.map(u => u.hostname),
				}),
			),
		)

		expect(extractUpstreams(json)).toStrictEqual(upstreams)
	})

	it('round-trips a multi-upstream config', () => {
		const upstreams = [
			{ hostname: 'acme.example.com', dial: '127.0.0.1:8080' },
			{ hostname: 'dev.acme.example.com', dial: '127.0.0.1:8081' },
		]
		const routes = upstreams.map(buildUpstreamRoute)
		const json = JSON.stringify(
			buildCaddyConfig(
				makeInput({
					routes,
					subjects: upstreams.map(u => u.hostname),
				}),
			),
		)

		expect(extractUpstreams(json)).toStrictEqual(upstreams)
	})

	it('returns empty array for empty object', () => {
		expect(extractUpstreams('{}')).toStrictEqual([])
	})

	it('returns empty array for empty string', () => {
		expect(extractUpstreams('')).toStrictEqual([])
	})

	it('throws on malformed JSON', () => {
		expect(() => extractUpstreams('not json')).toThrow()
	})

	it('returns empty array when routes array is empty', () => {
		const json = JSON.stringify(buildCaddyConfig(makeInput()))
		expect(extractUpstreams(json)).toStrictEqual([])
	})
})
