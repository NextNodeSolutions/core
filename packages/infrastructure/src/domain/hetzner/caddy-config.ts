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
