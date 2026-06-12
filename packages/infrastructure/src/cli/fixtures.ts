import type {
	DeployableConfig,
	PostgresServiceConfig,
	UserServiceConfig,
} from '#/config/types.ts'

// Every fixture shares the same project/scripts shell; each varies only in
// its deploy services, secret pool, or backing services. The builders keep
// each fixture's DELTA visible instead of repeating the full config.

interface HetznerAppFixture {
	readonly appService: UserServiceConfig
	readonly secrets?: ReadonlyArray<string>
	readonly postgres?: PostgresServiceConfig
}

function hetznerApp({
	appService,
	secrets = [],
	postgres,
}: HetznerAppFixture): DeployableConfig {
	return {
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
		services: postgres === undefined ? {} : { postgres },
		deploy: {
			target: 'hetzner-vps',
			hetzner: { serverType: 'cx23', location: 'nbg1' },
			generatedSecrets: [],
			secrets,
			vps: null,
			volumes: [],
			services: { app: appService },
		},
	}
}

interface StaticSiteFixture {
	readonly domain?: string
	readonly secrets?: ReadonlyArray<string>
}

function staticSite({
	domain,
	secrets = [],
}: StaticSiteFixture): DeployableConfig {
	return {
		project: {
			type: 'static',
			name: 'my-site',
			...(domain === undefined ? {} : { domain }),
			redirectDomains: [],
			filter: false,
			internal: false,
		},
		scripts: { lint: 'lint', test: 'test', build: 'build' },
		package: false,
		environment: { development: true },
		services: {},
		deploy: {
			target: 'cloudflare-pages',
			secrets,
			generatedSecrets: [],
			vps: null,
			volumes: [],
		},
	}
}

const BUILD_APP_SERVICE: UserServiceConfig = {
	port: 3000,
	secrets: [],
	needs: [],
	dependsOn: [],
	source: 'build',
	target: 'app',
}

export const APP_WITH_DOMAIN: DeployableConfig = hetznerApp({
	appService: BUILD_APP_SERVICE,
})

export const APP_WITH_BUILD_ARGS: DeployableConfig = hetznerApp({
	appService: { ...BUILD_APP_SERVICE, buildArgs: ['ANALYTICS_ID'] },
})

export const APP_UPSTREAM_PUBLIC: DeployableConfig = hetznerApp({
	appService: {
		port: 3000,
		secrets: [],
		needs: [],
		dependsOn: [],
		source: 'upstream',
		ref: 'docker.io/library/nginx:1.27',
	},
})

export const APP_UPSTREAM_PRIVATE: DeployableConfig = hetznerApp({
	appService: {
		port: 3000,
		secrets: [],
		needs: [],
		dependsOn: [],
		source: 'upstream',
		ref: 'docker.io/private/app:1.0',
		registryAuthSecret: 'DOCKERHUB_TOKEN',
	},
})

export const APP_WITH_POSTGRES: DeployableConfig = hetznerApp({
	appService: { ...BUILD_APP_SERVICE, needs: ['postgres'] },
	postgres: { mode: 'embedded' },
})

export const APP_WITH_POSTGRES_EXTERNAL: DeployableConfig = hetznerApp({
	appService: { ...BUILD_APP_SERVICE, needs: ['postgres'] },
	postgres: { mode: 'external' },
})

export const APP_WITH_POSTGRES_CUSTOM_MIGRATE: DeployableConfig = hetznerApp({
	appService: { ...BUILD_APP_SERVICE, needs: ['postgres'] },
	postgres: {
		mode: 'embedded',
		migrateCommand: 'pnpm prisma migrate deploy',
	},
})

// hetzner pool = global [deploy].secrets ∪ every service's own secrets;
// here the only secret is declared on the service that needs it.
export const APP_WITH_SECRETS: DeployableConfig = hetznerApp({
	appService: { ...BUILD_APP_SERVICE, secrets: ['DATABASE_URL'] },
	secrets: ['DATABASE_URL'],
})

export const STATIC_WITH_DOMAIN: DeployableConfig = staticSite({
	domain: 'example.com',
})

export const STATIC_NO_DOMAIN: DeployableConfig = staticSite({})

export const STATIC_WITH_SECRETS: DeployableConfig = staticSite({
	domain: 'example.com',
	secrets: ['RESEND_API_KEY'],
})

export const STATIC_WITH_MISSING_SECRET: DeployableConfig = staticSite({
	domain: 'example.com',
	secrets: ['MISSING_KEY'],
})
