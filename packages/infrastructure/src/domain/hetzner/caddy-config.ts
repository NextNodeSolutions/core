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

export interface CaddyConfigInput {
	readonly upstreams: ReadonlyArray<CaddyUpstream>
	readonly r2Storage: R2StorageConfig
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

export interface CaddyTlsPolicy {
	readonly subjects: ReadonlyArray<string>
	readonly storage: {
		readonly module: string
		readonly host: string
		readonly bucket: string
		readonly access_id: string
		readonly secret_key: string
		readonly prefix: string
	}
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
