import type {
	CaddyConfigInput,
	CaddyJsonConfig,
	CaddyRoute,
	CaddyUpstream,
} from './caddy-config.ts'

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
