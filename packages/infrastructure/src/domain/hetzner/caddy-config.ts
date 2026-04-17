export interface CaddyUpstream {
	readonly hostname: string
	readonly dial: string
}

export interface R2StorageConfig {
	readonly host: string
	readonly bucket: string
	readonly accessId: string
	readonly secretKey: string
	readonly prefix: string
}

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

export interface CaddyConfigInput {
	readonly upstreams: ReadonlyArray<CaddyUpstream>
	readonly r2Storage: R2StorageConfig
	readonly acmeEmail: string
}

export interface CaddyRoute {
	readonly match: ReadonlyArray<{ readonly host: ReadonlyArray<string> }>
	readonly handle: ReadonlyArray<CaddyHandler>
	readonly terminal: boolean
}

export interface CaddyHandler {
	readonly handler: string
	readonly upstreams: ReadonlyArray<{ readonly dial: string }>
}

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

function buildRoute(upstream: CaddyUpstream): CaddyRoute {
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function extractRoutes(configJson: string): ReadonlyArray<unknown> {
	if (!configJson.trim()) return []

	const parsed: unknown = JSON.parse(configJson)
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
	const hostnames = input.upstreams.map(u => u.hostname)

	return {
		apps: {
			http: {
				servers: {
					https: {
						listen: [':443'],
						routes: input.upstreams.map(buildRoute),
					},
				},
			},
			tls: {
				automation: {
					policies: [
						{
							subjects: hostnames,
							issuers: [
								{ module: 'acme', email: input.acmeEmail },
							],
							storage: {
								module: 's3',
								host: input.r2Storage.host,
								bucket: input.r2Storage.bucket,
								access_id: input.r2Storage.accessId,
								secret_key: input.r2Storage.secretKey,
								prefix: input.r2Storage.prefix,
							},
						},
					],
				},
			},
		},
	}
}

export interface InternalCaddyConfigInput {
	readonly upstreams: ReadonlyArray<CaddyUpstream>
	readonly r2Storage: R2StorageConfig
	readonly acmeEmail: string
	readonly cloudflareApiToken: string
}

/**
 * Build a Caddy JSON config for internal (Tailscale-only) projects.
 *
 * Uses DNS-01 challenge via Cloudflare instead of HTTP-01, so Let's Encrypt
 * can issue real certs even though the server is not publicly reachable.
 * Certs are stored in R2 (same as public mode).
 */
export function buildInternalCaddyConfig(
	input: InternalCaddyConfigInput,
): CaddyJsonConfig {
	const hostnames = input.upstreams.map(u => u.hostname)

	return {
		apps: {
			http: {
				servers: {
					https: {
						listen: [':443'],
						routes: input.upstreams.map(buildRoute),
					},
				},
			},
			tls: {
				automation: {
					policies: [
						{
							subjects: hostnames,
							issuers: [
								{
									module: 'acme',
									email: input.acmeEmail,
									challenges: {
										http: { disabled: true },
										'tls-alpn': { disabled: true },
										dns: {
											provider: {
												name: 'cloudflare',
												api_token:
													input.cloudflareApiToken,
											},
										},
									},
								},
							],
							storage: {
								module: 's3',
								host: input.r2Storage.host,
								bucket: input.r2Storage.bucket,
								access_id: input.r2Storage.accessId,
								secret_key: input.r2Storage.secretKey,
								prefix: input.r2Storage.prefix,
							},
						},
					],
				},
			},
		},
	}
}
