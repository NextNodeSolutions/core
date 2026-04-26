import { describe, expect, it } from 'vitest'

import type {
	CaddyConfigInput,
	InternalCaddyConfigInput,
} from './caddy-config.ts'
import {
	buildCaddyConfig,
	buildInternalCaddyConfig,
	extractUpstreams,
} from './caddy-config.ts'

const STORAGE_BINDING = {
	host: 'abc123.r2.cloudflarestorage.com',
	bucket: 'nextnode-certs',
	accessKeyId: 'R2_ACCESS_KEY',
	prefix: 'certs',
} as const

function makeInput(upstreams: CaddyConfigInput['upstreams']): CaddyConfigInput {
	return {
		upstreams,
		storage: STORAGE_BINDING,
		acmeEmail: 'test@example.com',
	}
}

describe('buildCaddyConfig', () => {
	it('builds a single-env config with one route', () => {
		const config = buildCaddyConfig(
			makeInput([
				{ hostname: 'acme.example.com', dial: '127.0.0.1:8080' },
			]),
		)

		const routes = config.apps.http.servers.https.routes
		expect(routes).toHaveLength(1)
		expect(routes[0]?.match).toStrictEqual([{ host: ['acme.example.com'] }])
		expect(routes[0]?.handle).toStrictEqual([
			{
				handler: 'reverse_proxy',
				upstreams: [{ dial: '127.0.0.1:8080' }],
			},
		])
		expect(routes[0]?.terminal).toBe(true)
	})

	it('builds multi-env config with separate routes', () => {
		const config = buildCaddyConfig(
			makeInput([
				{ hostname: 'acme.example.com', dial: '127.0.0.1:8080' },
				{ hostname: 'dev.acme.example.com', dial: '127.0.0.1:8081' },
			]),
		)

		const routes = config.apps.http.servers.https.routes
		expect(routes).toHaveLength(2)
		expect(routes[0]?.match[0]?.host).toStrictEqual(['acme.example.com'])
		expect(routes[0]?.handle[0]?.upstreams[0]?.dial).toBe('127.0.0.1:8080')
		expect(routes[1]?.match[0]?.host).toStrictEqual([
			'dev.acme.example.com',
		])
		expect(routes[1]?.handle[0]?.upstreams[0]?.dial).toBe('127.0.0.1:8081')
	})

	it('listens on :443', () => {
		const config = buildCaddyConfig(
			makeInput([
				{ hostname: 'acme.example.com', dial: '127.0.0.1:8080' },
			]),
		)
		expect(config.apps.http.servers.https.listen).toStrictEqual([':443'])
	})

	it('includes all hostnames in TLS automation subjects', () => {
		const config = buildCaddyConfig(
			makeInput([
				{ hostname: 'acme.example.com', dial: '127.0.0.1:8080' },
				{ hostname: 'dev.acme.example.com', dial: '127.0.0.1:8081' },
			]),
		)

		const subjects = config.apps.tls.automation.policies[0]?.subjects
		expect(subjects).toStrictEqual([
			'acme.example.com',
			'dev.acme.example.com',
		])
	})

	it('includes ACME issuer with email in TLS policy', () => {
		const config = buildCaddyConfig(
			makeInput([
				{ hostname: 'acme.example.com', dial: '127.0.0.1:8080' },
			]),
		)

		const issuers = config.apps.tls.automation.policies[0]?.issuers
		expect(issuers).toStrictEqual([
			{ module: 'acme', email: 'test@example.com' },
		])
	})

	it('configures R2 storage via caddy-storage-s3 module', () => {
		const config = buildCaddyConfig(
			makeInput([
				{ hostname: 'acme.example.com', dial: '127.0.0.1:8080' },
			]),
		)

		const storage = config.apps.tls.automation.policies[0]?.storage
		expect(storage).toStrictEqual({
			module: 's3',
			host: 'abc123.r2.cloudflarestorage.com',
			bucket: 'nextnode-certs',
			access_id: 'R2_ACCESS_KEY',
			secret_key: '{env.CADDY_R2_SECRET_KEY}',
			prefix: 'certs',
		})
	})

	it('produces valid JSON for Caddy /load endpoint', () => {
		const config = buildCaddyConfig(
			makeInput([
				{ hostname: 'acme.example.com', dial: '127.0.0.1:8080' },
			]),
		)
		const json = JSON.stringify(config)
		expect(() => JSON.parse(json)).not.toThrow()
	})
})

describe('extractUpstreams', () => {
	it('round-trips a single-upstream config', () => {
		const upstreams = [
			{ hostname: 'acme.example.com', dial: '127.0.0.1:8080' },
		]
		const config = buildCaddyConfig(makeInput(upstreams))
		const json = JSON.stringify(config)

		expect(extractUpstreams(json)).toStrictEqual(upstreams)
	})

	it('round-trips a multi-upstream config', () => {
		const upstreams = [
			{ hostname: 'acme.example.com', dial: '127.0.0.1:8080' },
			{ hostname: 'dev.acme.example.com', dial: '127.0.0.1:8081' },
		]
		const config = buildCaddyConfig(makeInput(upstreams))
		const json = JSON.stringify(config)

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
		const config = buildCaddyConfig(makeInput([]))
		const json = JSON.stringify(config)

		expect(extractUpstreams(json)).toStrictEqual([])
	})
})

describe('buildInternalCaddyConfig', () => {
	function makeInternalInput(
		upstreams: InternalCaddyConfigInput['upstreams'],
	): InternalCaddyConfigInput {
		return {
			upstreams,
			storage: STORAGE_BINDING,
			acmeEmail: 'test@example.com',
		}
	}

	it('uses DNS-01 challenge with Cloudflare provider', () => {
		const config = buildInternalCaddyConfig(
			makeInternalInput([
				{ hostname: 'monitor.example.com', dial: '127.0.0.1:8080' },
			]),
		)

		const issuer = config.apps.tls.automation.policies[0]?.issuers[0]
		expect(issuer).toStrictEqual({
			module: 'acme',
			email: 'test@example.com',
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

	it('disables HTTP-01 and TLS-ALPN challenges', () => {
		const config = buildInternalCaddyConfig(
			makeInternalInput([
				{ hostname: 'monitor.example.com', dial: '127.0.0.1:8080' },
			]),
		)

		const issuer = config.apps.tls.automation.policies[0]?.issuers[0]
		if (!issuer || issuer.module !== 'acme')
			throw new Error('Expected ACME issuer')
		expect(issuer.challenges?.http).toStrictEqual({ disabled: true })
		expect(issuer.challenges?.['tls-alpn']).toStrictEqual({
			disabled: true,
		})
	})

	it('stores certs in R2 (same as public mode)', () => {
		const config = buildInternalCaddyConfig(
			makeInternalInput([
				{ hostname: 'monitor.example.com', dial: '127.0.0.1:8080' },
			]),
		)

		expect(config.apps.tls.automation.policies[0]?.storage).toStrictEqual({
			module: 's3',
			host: 'abc123.r2.cloudflarestorage.com',
			bucket: 'nextnode-certs',
			access_id: 'R2_ACCESS_KEY',
			secret_key: '{env.CADDY_R2_SECRET_KEY}',
			prefix: 'certs',
		})
	})

	it('builds routes identical to public mode', () => {
		const upstreams = [
			{ hostname: 'monitor.example.com', dial: '127.0.0.1:8080' },
		] as const
		const internal = buildInternalCaddyConfig(
			makeInternalInput([...upstreams]),
		)
		const publicConfig = buildCaddyConfig(makeInput([...upstreams]))

		expect(internal.apps.http).toStrictEqual(publicConfig.apps.http)
	})

	it('produces valid JSON for Caddy /load endpoint', () => {
		const config = buildInternalCaddyConfig(
			makeInternalInput([
				{ hostname: 'monitor.example.com', dial: '127.0.0.1:8080' },
			]),
		)
		const json = JSON.stringify(config)
		expect(() => JSON.parse(json)).not.toThrow()
	})
})
