import type { DeployableConfig } from '#/config/types.ts'

export const APP_WITH_DOMAIN: DeployableConfig = {
	project: {
		type: 'app',
		name: 'my-app',
		domain: 'example.com',
		redirectDomains: [],
		filter: false,
		internal: false,
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: true },
	services: {},
	deploy: {
		target: 'hetzner-vps',
		hetzner: { serverType: 'cx23', location: 'nbg1' },
		secrets: [],
	},
}

export const APP_WITH_SECRETS: DeployableConfig = {
	project: {
		type: 'app',
		name: 'my-app',
		domain: 'example.com',
		redirectDomains: [],
		filter: false,
		internal: false,
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: true },
	services: {},
	deploy: {
		target: 'hetzner-vps',
		hetzner: { serverType: 'cx23', location: 'nbg1' },
		secrets: ['DATABASE_URL'],
	},
}

export const STATIC_WITH_DOMAIN: DeployableConfig = {
	project: {
		type: 'static',
		name: 'my-site',
		domain: 'example.com',
		redirectDomains: [],
		filter: false,
		internal: false,
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: true },
	services: {},
	deploy: { target: 'cloudflare-pages', secrets: [] },
}

export const STATIC_NO_DOMAIN: DeployableConfig = {
	project: {
		type: 'static',
		name: 'my-site',
		domain: undefined,
		redirectDomains: [],
		filter: false,
		internal: false,
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: true },
	services: {},
	deploy: { target: 'cloudflare-pages', secrets: [] },
}

export const STATIC_WITH_SECRETS: DeployableConfig = {
	project: {
		type: 'static',
		name: 'my-site',
		domain: 'example.com',
		redirectDomains: [],
		filter: false,
		internal: false,
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: true },
	services: {},
	deploy: { target: 'cloudflare-pages', secrets: ['RESEND_API_KEY'] },
}

export const STATIC_WITH_MISSING_SECRET: DeployableConfig = {
	project: {
		type: 'static',
		name: 'my-site',
		domain: 'example.com',
		redirectDomains: [],
		filter: false,
		internal: false,
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: true },
	services: {},
	deploy: { target: 'cloudflare-pages', secrets: ['MISSING_KEY'] },
}
