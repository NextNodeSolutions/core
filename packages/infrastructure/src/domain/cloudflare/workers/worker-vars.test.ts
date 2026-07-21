import { describe, expect, it } from 'vitest'

import { buildWorkerVars } from './worker-vars.ts'

import type { WorkerServiceConfig } from '#/config/types.ts'
import type {
	WorkersBackingConfig,
	WorkersTerraformOutputs,
} from './outputs-env.ts'

const worker = (
	overrides: Partial<WorkerServiceConfig> = {},
): WorkerServiceConfig => ({
	secrets: [],
	needs: [],
	dependsOn: [],
	entry: 'dist/_worker.js/index.js',
	...overrides,
})

const FULL_BACKING: WorkersBackingConfig = {
	hasD1: true,
	kvAliases: ['sessions'],
	queueAliases: ['jobs'],
	bucketAliases: ['assets'],
	cdnBucketAliases: ['assets'],
}

const FULL_OUTPUTS: WorkersTerraformOutputs = {
	d1DatabaseId: 'db-uuid',
	kvNamespaceIds: { sessions: 'kv-1' },
	queueIds: { jobs: 'q-1' },
	r2Buckets: { assets: 'proj-production-assets' },
	r2CdnUrls: { assets: 'https://assets.cdn.example.com' },
}

const EMPTY_OUTPUTS: WorkersTerraformOutputs = {
	kvNamespaceIds: {},
	queueIds: {},
	r2Buckets: {},
	r2CdnUrls: {},
}

const EMPTY_BACKING: WorkersBackingConfig = {
	hasD1: false,
	kvAliases: [],
	queueAliases: [],
	bucketAliases: [],
	cdnBucketAliases: [],
}

const input = (
	overrides: {
		service?: WorkerServiceConfig
		services?: Record<string, WorkerServiceConfig>
		backing?: WorkersBackingConfig
		outputs?: WorkersTerraformOutputs
		environment?: 'production' | 'development'
		projectDomain?: string
		accountId?: string
	} = {},
): Parameters<typeof buildWorkerVars>[0] => ({
	projectDomain: overrides.projectDomain ?? 'example.com',
	environment: overrides.environment ?? 'production',
	service: overrides.service ?? worker(),
	services: overrides.services ?? { web: overrides.service ?? worker() },
	backing: overrides.backing ?? EMPTY_BACKING,
	outputs: overrides.outputs ?? EMPTY_OUTPUTS,
	accountId: overrides.accountId ?? 'acct-123',
})

describe('buildWorkerVars', () => {
	it('always injects the project SITE_URL, https-prefixed', () => {
		expect(buildWorkerVars(input())['SITE_URL']).toBe('https://example.com')
	})

	it('resolves SITE_URL to the dev hostname in development', () => {
		expect(
			buildWorkerVars(input({ environment: 'development' }))['SITE_URL'],
		).toBe('https://dev.example.com')
	})

	it('injects the symmetric <NAME>_URL block for every routed peer, self included', () => {
		const web = worker({ url: 'example.com' })
		const api = worker({ url: 'api.example.com' })
		expect(
			buildWorkerVars(input({ service: web, services: { web, api } })),
		).toEqual({
			SITE_URL: 'https://example.com',
			WEB_URL: 'https://example.com',
			API_URL: 'https://api.example.com',
		})
	})

	it('omits the URL of an internal (non-routed) peer but still routes the routed ones', () => {
		const web = worker({ url: 'example.com' })
		const jobs = worker()
		expect(
			buildWorkerVars(input({ service: jobs, services: { web, jobs } })),
		).toEqual({
			SITE_URL: 'https://example.com',
			WEB_URL: 'https://example.com',
		})
	})

	it('gives a non-routed worker the same peer URL block (symmetry has no owner)', () => {
		const web = worker({ url: 'example.com' })
		const api = worker({ url: 'api.example.com' })
		const jobs = worker()
		expect(
			buildWorkerVars(
				input({ service: jobs, services: { web, api, jobs } }),
			),
		).toEqual({
			SITE_URL: 'https://example.com',
			WEB_URL: 'https://example.com',
			API_URL: 'https://api.example.com',
		})
	})

	it('injects no backing env for a worker that declares no needs', () => {
		expect(
			buildWorkerVars(
				input({
					service: worker({ url: 'example.com' }),
					services: { web: worker({ url: 'example.com' }) },
					backing: FULL_BACKING,
					outputs: FULL_OUTPUTS,
				}),
			),
		).toEqual({
			SITE_URL: 'https://example.com',
			WEB_URL: 'https://example.com',
		})
	})

	it('injects only the D1 backing env for a worker that needs d1', () => {
		const svc = worker({ needs: ['d1'] })
		expect(
			buildWorkerVars(
				input({
					service: svc,
					services: { web: svc },
					backing: FULL_BACKING,
					outputs: FULL_OUTPUTS,
				}),
			),
		).toEqual({
			SITE_URL: 'https://example.com',
			D1_DATABASE_ID: 'db-uuid',
		})
	})

	it('injects only the KV backing env for a worker that needs kv', () => {
		const svc = worker({ needs: ['kv'] })
		expect(
			buildWorkerVars(
				input({
					service: svc,
					services: { web: svc },
					backing: FULL_BACKING,
					outputs: FULL_OUTPUTS,
				}),
			),
		).toEqual({
			SITE_URL: 'https://example.com',
			KV_NAMESPACE_SESSIONS_ID: 'kv-1',
		})
	})

	it('injects the full R2 backing env (names, CDN URL, endpoint) for a worker that needs r2', () => {
		const svc = worker({ needs: ['r2'] })
		expect(
			buildWorkerVars(
				input({
					service: svc,
					services: { web: svc },
					backing: FULL_BACKING,
					outputs: FULL_OUTPUTS,
				}),
			),
		).toEqual({
			SITE_URL: 'https://example.com',
			R2_BUCKET_ASSETS: 'proj-production-assets',
			R2_BUCKET_ASSETS_URL: 'https://assets.cdn.example.com',
			R2_ENDPOINT: 'https://acct-123.r2.cloudflarestorage.com',
		})
	})

	it('withholds a backing resource a worker does not need while including one it does', () => {
		const svc = worker({ needs: ['d1', 'queues'] })
		expect(
			buildWorkerVars(
				input({
					service: svc,
					services: { web: svc },
					backing: FULL_BACKING,
					outputs: FULL_OUTPUTS,
				}),
			),
		).toEqual({
			SITE_URL: 'https://example.com',
			D1_DATABASE_ID: 'db-uuid',
			QUEUE_JOBS_ID: 'q-1',
		})
	})

	it('keeps the project SITE_URL authoritative over a peer named "site"', () => {
		const site = worker({ url: 'other.example.com' })
		expect(
			buildWorkerVars(
				input({
					projectDomain: 'example.com',
					service: site,
					services: { site },
				}),
			)['SITE_URL'],
		).toBe('https://example.com')
	})
})
