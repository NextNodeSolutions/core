import { isRecord } from '#/kernel/guards.ts'
import { parseJsonOrThrow } from '#/kernel/json.ts'

import type { ObjectStorageBinding } from '#/domain/storage/binding.ts'

export interface CaddyUpstream {
	readonly hostname: string
	readonly dial: string
}

/** Caddy reads env vars from /etc/caddy/env at startup via EnvironmentFile. */
export const CADDY_ENV_R2_SECRET_KEY = 'CADDY_R2_SECRET_KEY'
export const CADDY_ENV_CF_API_TOKEN = 'CF_DNS_API_TOKEN'

export interface AcmeIssuer {
	readonly module: 'acme'
	readonly email: string
	readonly challenges?: {
		readonly http?: { readonly disabled: boolean }
		readonly 'tls-alpn'?: { readonly disabled: boolean }
		readonly dns?: {
			readonly provider: {
				readonly name: string
				readonly api_token: string
			}
		}
	}
}

export interface InternalIssuer {
	readonly module: 'internal'
}

export type CaddyIssuer = AcmeIssuer | InternalIssuer

/**
 * ACME issuer with HTTP-01 challenge — Let's Encrypt over the public
 * internet. Caddy serves the challenge on :80 of the public IP.
 */
export function buildPublicAcmeIssuer(email: string): AcmeIssuer {
	return { module: 'acme', email }
}

/**
 * ACME issuer with DNS-01 challenge via Cloudflare — for projects whose
 * server is not publicly reachable (e.g. Tailscale-only). Let's Encrypt
 * issues real certs by validating DNS records the operator owns through
 * Cloudflare. HTTP-01 and TLS-ALPN are explicitly disabled so Caddy never
 * tries to fall back to them.
 */
export function buildDnsAcmeIssuer(email: string): AcmeIssuer {
	return {
		module: 'acme',
		email,
		challenges: {
			http: { disabled: true },
			'tls-alpn': { disabled: true },
			dns: {
				provider: {
					name: 'cloudflare',
					api_token: `{env.${CADDY_ENV_CF_API_TOKEN}}`,
				},
			},
		},
	}
}

export interface CaddyConfigInput {
	readonly routes: ReadonlyArray<CaddyRoute>
	readonly subjects: ReadonlyArray<string>
	readonly storage: ObjectStorageBinding
	readonly issuer: CaddyIssuer
}

export interface CaddyRoute {
	readonly match: ReadonlyArray<{ readonly host: ReadonlyArray<string> }>
	readonly handle: ReadonlyArray<CaddyHandler>
	readonly terminal: boolean
}

export interface CaddyReverseProxyHandler {
	readonly handler: 'reverse_proxy'
	readonly upstreams: ReadonlyArray<{ readonly dial: string }>
}

export interface CaddyBasicAuthAccount {
	readonly username: string
	readonly password: string
}

export interface CaddyBasicAuthHandler {
	readonly handler: 'authentication'
	readonly providers: {
		readonly http_basic: {
			readonly accounts: ReadonlyArray<CaddyBasicAuthAccount>
		}
	}
}

export type CaddyHandler = CaddyReverseProxyHandler | CaddyBasicAuthHandler

export interface CaddyS3Storage {
	readonly module: string
	readonly host: string
	readonly bucket: string
	readonly access_id: string
	readonly secret_key: string
	readonly prefix: string
}

export interface CaddyTlsPolicy {
	readonly subjects: ReadonlyArray<string>
	readonly issuers: ReadonlyArray<CaddyIssuer>
	readonly storage?: CaddyS3Storage
}

export interface CaddyJsonConfig {
	readonly apps: {
		readonly http: {
			readonly servers: {
				readonly https: {
					readonly listen: ReadonlyArray<string>
					readonly routes: ReadonlyArray<CaddyRoute>
				}
			}
		}
		readonly tls: {
			readonly automation: {
				readonly policies: ReadonlyArray<CaddyTlsPolicy>
			}
		}
	}
}

export function buildUpstreamRoute(upstream: CaddyUpstream): CaddyRoute {
	return {
		match: [{ host: [upstream.hostname] }],
		handle: [
			{
				handler: 'reverse_proxy',
				upstreams: [{ dial: upstream.dial }],
			},
		],
		terminal: true,
	}
}

function extractRoutes(configJson: string): ReadonlyArray<unknown> {
	if (!configJson.trim()) return []

	const parsed: unknown = parseJsonOrThrow(configJson, 'Caddy config')
	if (!isRecord(parsed) || !isRecord(parsed.apps)) return []
	if (!isRecord(parsed.apps.http) || !isRecord(parsed.apps.http.servers))
		return []

	const httpsServer = parsed.apps.http.servers.https
	if (!isRecord(httpsServer) || !Array.isArray(httpsServer.routes)) return []

	return httpsServer.routes
}

function parseRouteUpstream(route: unknown): CaddyUpstream | null {
	if (!isRecord(route)) return null

	const match = route.match
	const handle = route.handle
	if (!Array.isArray(match) || !Array.isArray(handle)) return null

	const firstMatch: unknown = match[0]
	const firstHandle: unknown = handle[0]
	if (!isRecord(firstMatch) || !isRecord(firstHandle)) return null

	if (
		!Array.isArray(firstMatch.host) ||
		typeof firstMatch.host[0] !== 'string'
	)
		return null

	if (!Array.isArray(firstHandle.upstreams)) return null
	const firstUpstream: unknown = firstHandle.upstreams[0]
	if (!isRecord(firstUpstream) || typeof firstUpstream.dial !== 'string')
		return null

	return { hostname: firstMatch.host[0], dial: firstUpstream.dial }
}

export function extractUpstreams(
	configJson: string,
): ReadonlyArray<CaddyUpstream> {
	return extractRoutes(configJson)
		.map(parseRouteUpstream)
		.filter((u): u is CaddyUpstream => u !== null)
}

export function buildCaddyConfig(input: CaddyConfigInput): CaddyJsonConfig {
	return {
		apps: {
			http: {
				servers: {
					https: {
						listen: [':443'],
						routes: input.routes,
					},
				},
			},
			tls: {
				automation: {
					policies: [
						{
							subjects: input.subjects,
							issuers: [input.issuer],
							storage: {
								module: 's3',
								host: input.storage.host,
								bucket: input.storage.bucket,
								access_id: input.storage.accessKeyId,
								secret_key: `{env.${CADDY_ENV_R2_SECRET_KEY}}`,
								prefix: input.storage.prefix,
							},
						},
					],
				},
			},
		},
	}
}
