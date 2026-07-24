import { describe, expect, it } from 'vitest'

import {
	CLOUDFLARE_PROVIDER_SOURCE,
	CLOUDFLARE_PROVIDER_VERSION,
	HCP_TERRAFORM_ORGANIZATION,
	buildTerraformMainConfig,
} from './terraform-config.ts'

import type { ServicesConfig } from '#/config/service-config.ts'
import type { CloudflareWorkersDeployableConfig } from '#/config/types.ts'
import type { WorkerServiceConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { TerraformMainConfig } from './terraform-main-config.ts'

const worker = (
	url: string,
	overrides: Partial<WorkerServiceConfig> = {},
): WorkerServiceConfig => ({
	url,
	secrets: [],
	needs: [],
	dependsOn: [],
	entry: 'dist/server/entry.mjs',
	observability: true,
	...overrides,
})

const config = (
	domain: string,
	options: {
		name?: string
		redirectDomains?: ReadonlyArray<string>
		services?: ServicesConfig
		workers?: Readonly<Record<string, WorkerServiceConfig>>
	} = {},
): CloudflareWorkersDeployableConfig => ({
	project: {
		name: options.name ?? 'studiobymina',
		type: 'app',
		filter: false,
		domain,
		redirectDomains: options.redirectDomains ?? [],
		internal: false,
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: true },
	deploy: {
		target: 'cloudflare-workers',
		vps: null,
		volumes: [],
		generatedSecrets: [],
		secrets: [],
		services: options.workers ?? { web: worker('studiobymina.com') },
		cron: [],
	},
	services: options.services ?? {},
})

const FULL_SERVICES: ServicesConfig = {
	d1: { migrationsFolder: 'drizzle' },
	kv: { namespaces: [{ name: 'sessions' }, { name: 'cache' }] },
	queues: { queues: [{ name: 'emails' }] },
	r2: {
		buckets: [
			{ name: 'assets', cdn: true },
			{ name: 'private-cache', cdn: false },
		],
	},
}

const FULL_WORKERS: Readonly<Record<string, WorkerServiceConfig>> = {
	web: worker('studiobymina.com'),
	back: worker('api.studiobymina.com', { needs: ['d1'] }),
	admin: worker('admin.studiobymina.com'),
}

const build = (
	domain: string,
	environment: AppEnvironment,
	options: Parameters<typeof config>[1] = {},
): TerraformMainConfig =>
	buildTerraformMainConfig(config(domain, options), environment)

describe('buildTerraformMainConfig', () => {
	it('renders the full production config (workers + d1 + kv + queues + r2 cdn + redirect)', () => {
		const tfConfig = build('studiobymina.com', 'production', {
			redirectDomains: ['studiobymina.fr'],
			services: FULL_SERVICES,
			workers: FULL_WORKERS,
		})

		expect(tfConfig).toEqual({
			terraform: {
				cloud: {
					organization: 'nextnode',
					workspaces: { name: 'studiobymina-production' },
				},
				required_providers: {
					cloudflare: {
						source: 'cloudflare/cloudflare',
						version: '~> 5.0',
					},
				},
			},
			provider: { cloudflare: {} },
			variable: { account_id: { type: 'string' } },
			data: {
				cloudflare_zone: {
					zone_main: { filter: { name: 'studiobymina.com' } },
					zone_redirect_studiobymina_fr: {
						filter: { name: 'studiobymina.fr' },
					},
				},
			},
			resource: {
				cloudflare_d1_database: {
					d1: {
						account_id: '${var.account_id}',
						name: 'studiobymina-production-d1',
						read_replication: { mode: 'disabled' },
					},
				},
				cloudflare_workers_kv_namespace: {
					kv_sessions: {
						account_id: '${var.account_id}',
						title: 'studiobymina-production-sessions',
					},
					kv_cache: {
						account_id: '${var.account_id}',
						title: 'studiobymina-production-cache',
					},
				},
				cloudflare_queue: {
					queue_emails: {
						account_id: '${var.account_id}',
						queue_name: 'studiobymina-production-emails',
					},
				},
				cloudflare_r2_bucket: {
					r2_assets: {
						account_id: '${var.account_id}',
						name: 'studiobymina-production-assets',
						location: 'weur',
					},
					r2_private_cache: {
						account_id: '${var.account_id}',
						name: 'studiobymina-production-private-cache',
						location: 'weur',
					},
				},
				cloudflare_r2_custom_domain: {
					r2_assets_cdn: {
						account_id: '${var.account_id}',
						bucket_name: 'studiobymina-production-assets',
						domain: 'assets.cdn.studiobymina.com',
						zone_id: '${data.cloudflare_zone.zone_main.id}',
						enabled: true,
					},
				},
				cloudflare_dns_record: {
					redirect_studiobymina_fr_apex: {
						zone_id:
							'${data.cloudflare_zone.zone_redirect_studiobymina_fr.id}',
						name: 'studiobymina.fr',
						type: 'A',
						content: '192.0.2.1',
						ttl: 1,
						proxied: true,
					},
					redirect_studiobymina_fr_www: {
						zone_id:
							'${data.cloudflare_zone.zone_redirect_studiobymina_fr.id}',
						name: 'www.studiobymina.fr',
						type: 'A',
						content: '192.0.2.1',
						ttl: 1,
						proxied: true,
					},
				},
				cloudflare_ruleset: {
					redirect_studiobymina_fr: {
						zone_id:
							'${data.cloudflare_zone.zone_redirect_studiobymina_fr.id}',
						name: 'redirect-studiobymina_fr-to-main',
						kind: 'root',
						phase: 'http_request_dynamic_redirect',
						rules: [
							{
								ref: 'redirect_studiobymina_fr',
								description:
									'Redirect studiobymina.fr and www.studiobymina.fr to studiobymina.com',
								expression:
									'(http.host eq "studiobymina.fr" or http.host eq "www.studiobymina.fr")',
								action: 'redirect',
								action_parameters: {
									from_value: {
										target_url: {
											expression:
												'concat("https://studiobymina.com", http.request.uri.path)',
										},
										preserve_query_string: true,
										status_code: 301,
									},
								},
							},
						],
					},
				},
			},
			output: {
				d1_database_id: {
					value: '${cloudflare_d1_database.d1.id}',
				},
				kv_namespace_ids: {
					value: {
						sessions:
							'${cloudflare_workers_kv_namespace.kv_sessions.id}',
						cache: '${cloudflare_workers_kv_namespace.kv_cache.id}',
					},
				},
				queue_ids: {
					value: {
						emails: '${cloudflare_queue.queue_emails.id}',
					},
				},
				r2_buckets: {
					value: {
						assets: '${cloudflare_r2_bucket.r2_assets.id}',
						'private-cache':
							'${cloudflare_r2_bucket.r2_private_cache.id}',
					},
				},
				r2_cdn_urls: {
					value: {
						assets: 'https://assets.cdn.studiobymina.com',
					},
				},
			},
		})
	})

	it('renders a minimal single-worker config with no backing services and no redirect', () => {
		const tfConfig = build('minimal.com', 'production')

		expect(tfConfig).toEqual({
			terraform: {
				cloud: {
					organization: 'nextnode',
					workspaces: { name: 'studiobymina-production' },
				},
				required_providers: {
					cloudflare: {
						source: 'cloudflare/cloudflare',
						version: '~> 5.0',
					},
				},
			},
			provider: { cloudflare: {} },
			data: {
				cloudflare_zone: {
					zone_main: { filter: { name: 'minimal.com' } },
				},
			},
		})
	})

	it('omits empty resource and output blocks so terraform init does not fail on "Missing block label"', () => {
		const tfConfig = build('minimal.com', 'production')

		expect(tfConfig.resource).toBeUndefined()
		expect(tfConfig.output).toBeUndefined()
	})

	it('resolves the dev subdomain everywhere and omits redirect rules in development', () => {
		const tfConfig = build('studiobymina.com', 'development', {
			redirectDomains: ['studiobymina.fr'],
			services: FULL_SERVICES,
			workers: FULL_WORKERS,
		})

		expect(tfConfig).toEqual({
			terraform: {
				cloud: {
					organization: 'nextnode',
					workspaces: { name: 'studiobymina-development' },
				},
				required_providers: {
					cloudflare: {
						source: 'cloudflare/cloudflare',
						version: '~> 5.0',
					},
				},
			},
			provider: { cloudflare: {} },
			variable: { account_id: { type: 'string' } },
			data: {
				cloudflare_zone: {
					zone_main: { filter: { name: 'studiobymina.com' } },
				},
			},
			resource: {
				cloudflare_d1_database: {
					d1: {
						account_id: '${var.account_id}',
						name: 'studiobymina-development-d1',
						read_replication: { mode: 'disabled' },
					},
				},
				cloudflare_workers_kv_namespace: {
					kv_sessions: {
						account_id: '${var.account_id}',
						title: 'studiobymina-development-sessions',
					},
					kv_cache: {
						account_id: '${var.account_id}',
						title: 'studiobymina-development-cache',
					},
				},
				cloudflare_queue: {
					queue_emails: {
						account_id: '${var.account_id}',
						queue_name: 'studiobymina-development-emails',
					},
				},
				cloudflare_r2_bucket: {
					r2_assets: {
						account_id: '${var.account_id}',
						name: 'studiobymina-development-assets',
						location: 'weur',
					},
					r2_private_cache: {
						account_id: '${var.account_id}',
						name: 'studiobymina-development-private-cache',
						location: 'weur',
					},
				},
				cloudflare_r2_custom_domain: {
					r2_assets_cdn: {
						account_id: '${var.account_id}',
						bucket_name: 'studiobymina-development-assets',
						domain: 'assets.cdn.dev.studiobymina.com',
						zone_id: '${data.cloudflare_zone.zone_main.id}',
						enabled: true,
					},
				},
			},
			output: {
				d1_database_id: {
					value: '${cloudflare_d1_database.d1.id}',
				},
				kv_namespace_ids: {
					value: {
						sessions:
							'${cloudflare_workers_kv_namespace.kv_sessions.id}',
						cache: '${cloudflare_workers_kv_namespace.kv_cache.id}',
					},
				},
				queue_ids: {
					value: {
						emails: '${cloudflare_queue.queue_emails.id}',
					},
				},
				r2_buckets: {
					value: {
						assets: '${cloudflare_r2_bucket.r2_assets.id}',
						'private-cache':
							'${cloudflare_r2_bucket.r2_private_cache.id}',
					},
				},
				r2_cdn_urls: {
					value: {
						assets: 'https://assets.cdn.dev.studiobymina.com',
					},
				},
			},
		})
	})

	it('never emits a cloudflare_zone resource - the zone is always a data lookup', () => {
		const tfConfig = build('studiobymina.com', 'production', {
			redirectDomains: ['studiobymina.fr'],
			services: FULL_SERVICES,
		})

		expect(tfConfig.resource).not.toHaveProperty('cloudflare_zone')
		expect(Object.keys(tfConfig.data.cloudflare_zone)).toEqual([
			'zone_main',
			'zone_redirect_studiobymina_fr',
		])
	})

	it('never emits a workers script or worker custom domain (wrangler boundary)', () => {
		const tfConfig = build('studiobymina.com', 'production', {
			redirectDomains: ['studiobymina.fr'],
			services: FULL_SERVICES,
			workers: FULL_WORKERS,
		})

		expect(tfConfig.resource).not.toHaveProperty(
			'cloudflare_workers_script',
		)
		expect(tfConfig.resource).not.toHaveProperty('cloudflare_worker_domain')
		expect(tfConfig.resource).not.toHaveProperty(
			'cloudflare_workers_custom_domain',
		)
	})

	it('omits the account_id variable when no account-scoped resource is generated', () => {
		const tfConfig = build('minimal.com', 'production')

		expect(tfConfig.variable).toBeUndefined()
	})

	it('exposes the pinned provider coordinates as named constants', () => {
		expect(HCP_TERRAFORM_ORGANIZATION).toBe('nextnode')
		expect(CLOUDFLARE_PROVIDER_SOURCE).toBe('cloudflare/cloudflare')
		expect(CLOUDFLARE_PROVIDER_VERSION).toBe('~> 5.0')
	})

	it('generates the PlanetScale branch-role + Hyperdrive config wired origin', () => {
		const tfConfig = build('studiobymina.com', 'production', {
			services: { planetscale: { clusterSize: 'PS_10' } },
			workers: {
				back: worker('api.studiobymina.com', {
					needs: ['planetscale'],
				}),
			},
		})

		expect(
			tfConfig.resource?.planetscale_postgres_branch_role?.[
				'planetscale'
			],
		).toEqual({
			organization: 'nextnode',
			database: 'studiobymina-production-planetscale',
			branch: 'main',
			name: 'hyperdrive',
			inherited_roles: ['pg_read_all_data', 'pg_write_all_data'],
		})
		expect(
			tfConfig.resource?.cloudflare_hyperdrive_config?.['planetscale'],
		).toEqual({
			account_id: '${var.account_id}',
			name: 'studiobymina-production-hyperdrive',
			origin: {
				scheme: 'postgres',
				host: '${planetscale_postgres_branch_role.planetscale.access_host_url}',
				port: 5432,
				database:
					'${planetscale_postgres_branch_role.planetscale.database_name}',
				user: '${planetscale_postgres_branch_role.planetscale.username}',
				password:
					'${planetscale_postgres_branch_role.planetscale.password}',
			},
		})
		expect(tfConfig.output?.['hyperdrive_config_id']).toEqual({
			value: '${cloudflare_hyperdrive_config.planetscale.id}',
		})
	})

	it('pulls the PlanetScale provider only when a PlanetScale DB is declared', () => {
		const withPg = build('studiobymina.com', 'production', {
			services: { planetscale: {} },
			workers: {
				back: worker('api.studiobymina.com', {
					needs: ['planetscale'],
				}),
			},
		})
		expect(withPg.terraform.required_providers.planetscale).toEqual({
			source: 'planetscale/planetscale',
			version: '~> 1.5',
		})
		expect(withPg.provider.planetscale).toEqual({})

		const withoutPg = build('studiobymina.com', 'production', {
			services: FULL_SERVICES,
			workers: FULL_WORKERS,
		})
		expect(
			withoutPg.terraform.required_providers.planetscale,
		).toBeUndefined()
		expect(withoutPg.provider.planetscale).toBeUndefined()
	})
})
