import { describe, expect, it } from 'vitest'

import type { CaddyConfigInput } from './caddy-config.ts'
import { buildCaddyConfig } from './caddy-config.ts'

const r2Storage = {
	host: 'abc123.r2.cloudflarestorage.com',
	bucket: 'nextnode-certs',
	accessId: 'R2_ACCESS_KEY',
	secretKey: 'R2_SECRET_KEY',
	prefix: 'certs',
} as const

function makeInput(upstreams: CaddyConfigInput['upstreams']): CaddyConfigInput {
	return { upstreams, r2Storage }
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
			secret_key: 'R2_SECRET_KEY',
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
