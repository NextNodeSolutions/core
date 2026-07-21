import { describe, expect, it } from 'vitest'

import { buildWranglerConfig } from './wrangler-config.ts'
import {
	DEFAULT_WORKERS_COMPATIBILITY_DATE,
	WORKERS_COMPATIBILITY_FLAGS,
} from './wrangler-document.ts'

import type { ServicesConfig, WorkerServiceConfig } from '#/config/types.ts'
import type { WorkersTerraformOutputs } from './outputs-env.ts'
import type { WranglerConfigInput } from './wrangler-config.ts'

const EMPTY_OUTPUTS: WorkersTerraformOutputs = {
	kvNamespaceIds: {},
	queueIds: {},
	r2Buckets: {},
	r2CdnUrls: {},
}

const FULL_OUTPUTS: WorkersTerraformOutputs = {
	d1DatabaseId: 'db-uuid',
	kvNamespaceIds: { sessions: 'kv-1' },
	queueIds: { jobs: 'q-1' },
	r2Buckets: { assets: 'proj-production-assets' },
	r2CdnUrls: { assets: 'https://assets.cdn.example.com' },
}

const FULL_SERVICES: ServicesConfig = {
	d1: { migrationsFolder: 'drizzle' },
	kv: { namespaces: [{ name: 'sessions' }] },
	queues: { queues: [{ name: 'jobs' }] },
	r2: { buckets: [{ name: 'assets', cdn: true }] },
}

const service = (
	overrides: Partial<WorkerServiceConfig> = {},
): WorkerServiceConfig => ({
	secrets: [],
	needs: [],
	dependsOn: [],
	entry: 'dist/_worker.js/index.js',
	...overrides,
})

const input = (
	overrides: Partial<WranglerConfigInput> = {},
): WranglerConfigInput => ({
	projectName: 'proj',
	environment: 'production',
	serviceName: 'web',
	service: service(),
	services: {},
	outputs: EMPTY_OUTPUTS,
	cron: [],
	serviceNames: ['web'],
	vars: {},
	...overrides,
})

describe('buildWranglerConfig', () => {
	it('names the worker <project>-<env>-<service> with pinned compat + entry', () => {
		const document = buildWranglerConfig(input({ serviceName: 'api' }))

		expect(document.name).toBe('proj-production-api')
		expect(document.main).toBe('dist/_worker.js/index.js')
		expect(document.compatibility_date).toBe(
			DEFAULT_WORKERS_COMPATIBILITY_DATE,
		)
		expect(document.compatibility_flags).toEqual([
			...WORKERS_COMPATIBILITY_FLAGS,
		])
	})

	it('adds a Custom Domain route + workers_dev:false for a routed service', () => {
		const document = buildWranglerConfig(
			input({ service: service({ url: 'example.com' }) }),
		)

		expect(document.routes).toEqual([
			{ pattern: 'example.com', custom_domain: true },
		])
		expect(document.workers_dev).toBe(false)
	})

	it('prefixes the route host with dev. in development', () => {
		const document = buildWranglerConfig(
			input({
				environment: 'development',
				service: service({ url: 'api.example.com' }),
			}),
		)

		expect(document.routes).toEqual([
			{ pattern: 'dev.api.example.com', custom_domain: true },
		])
	})

	it('forces workers_dev:false and omits routes for an internal worker (no url)', () => {
		const document = buildWranglerConfig(input())

		expect(document.routes).toBeUndefined()
		expect(document.workers_dev).toBe(false)
	})

	it('derives the assets directory from the _worker.js entry convention', () => {
		const document = buildWranglerConfig(input())

		expect(document.assets).toEqual({
			directory: 'dist',
			binding: 'ASSETS',
		})
	})

	it('emits no assets when the entry does not match the convention', () => {
		const document = buildWranglerConfig(
			input({ service: service({ entry: 'build/server.js' }) }),
		)

		expect(document.assets).toBeUndefined()
	})

	it('binds only the resources the service declares in needs', () => {
		const document = buildWranglerConfig(
			input({
				services: FULL_SERVICES,
				outputs: FULL_OUTPUTS,
				service: service({ needs: ['d1', 'kv', 'r2', 'queues'] }),
			}),
		)

		expect(document.d1_databases).toEqual([
			{
				binding: 'DB',
				database_name: 'proj-production-d1',
				database_id: 'db-uuid',
				migrations_dir: 'drizzle',
			},
		])
		expect(document.kv_namespaces).toEqual([
			{ binding: 'KV_SESSIONS', id: 'kv-1' },
		])
		expect(document.r2_buckets).toEqual([
			{ binding: 'R2_ASSETS', bucket_name: 'proj-production-assets' },
		])
		expect(document.queues).toEqual({
			producers: [
				{ binding: 'QUEUE_JOBS', queue: 'proj-production-jobs' },
			],
		})
	})

	it('binds nothing when the service needs nothing even if backing exists', () => {
		const document = buildWranglerConfig(
			input({ services: FULL_SERVICES, outputs: FULL_OUTPUTS }),
		)

		expect(document.d1_databases).toBeUndefined()
		expect(document.kv_namespaces).toBeUndefined()
		expect(document.r2_buckets).toBeUndefined()
		expect(document.queues).toBeUndefined()
	})

	it('binds only the needed subset (d1 only)', () => {
		const document = buildWranglerConfig(
			input({
				services: FULL_SERVICES,
				outputs: FULL_OUTPUTS,
				service: service({ needs: ['d1'] }),
			}),
		)

		expect(document.d1_databases).toBeDefined()
		expect(document.kv_namespaces).toBeUndefined()
		expect(document.queues).toBeUndefined()
	})

	it('throws an actionable error when a needed output is missing', () => {
		expect(() =>
			buildWranglerConfig(
				input({
					services: { d1: { migrationsFolder: 'drizzle' } },
					outputs: EMPTY_OUTPUTS,
					service: service({ needs: ['d1'] }),
				}),
			),
		).toThrow(/d1_database_id is missing from the provision outputs/)
	})

	it('routes a cron to its explicit target service', () => {
		const jobs = [
			{
				name: 'sync',
				schedule: '0 * * * *',
				path: '/x',
				method: 'POST' as const,
				service: 'api',
			},
		]
		const forApi = buildWranglerConfig(
			input({
				serviceName: 'api',
				serviceNames: ['web', 'api'],
				cron: jobs,
			}),
		)
		const forWeb = buildWranglerConfig(
			input({
				serviceName: 'web',
				serviceNames: ['web', 'api'],
				cron: jobs,
			}),
		)

		expect(forApi.triggers).toEqual({ crons: ['0 * * * *'] })
		expect(forWeb.triggers).toBeUndefined()
	})

	it('routes a service-less cron to the primary (first declared) service', () => {
		const jobs = [
			{
				name: 'sync',
				schedule: '5 * * * *',
				path: '/x',
				method: 'POST' as const,
			},
		]
		const forWeb = buildWranglerConfig(
			input({
				serviceName: 'web',
				serviceNames: ['web', 'api'],
				cron: jobs,
			}),
		)
		const forApi = buildWranglerConfig(
			input({
				serviceName: 'api',
				serviceNames: ['web', 'api'],
				cron: jobs,
			}),
		)

		expect(forWeb.triggers).toEqual({ crons: ['5 * * * *'] })
		expect(forApi.triggers).toBeUndefined()
	})

	it('omits vars until they are provided', () => {
		expect(buildWranglerConfig(input()).vars).toBeUndefined()
		expect(
			buildWranglerConfig(input({ vars: { SITE_URL: 'https://x' } }))
				.vars,
		).toEqual({ SITE_URL: 'https://x' })
	})
})
