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
	entry: 'dist/server/entry.mjs',
	observability: true,
	...overrides,
})

const FULL_BACKING: WorkersBackingConfig = {
	hasD1: true,
	hasPlanetscale: false,
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
	hasPlanetscale: false,
	kvAliases: [],
	queueAliases: [],
	bucketAliases: [],
	cdnBucketAliases: [],
}

// web + admin routed, api internal - the project every peer-URL expectation
// below is written against.
const WEB_WORKER = worker({ url: 'example.com' })
const ADMIN_WORKER = worker({ url: 'admin.example.com' })
const API_WORKER = worker()
const PROJECT_WORKERS: Record<string, WorkerServiceConfig> = {
	web: WEB_WORKER,
	admin: ADMIN_WORKER,
	api: API_WORKER,
}

const input = (
	overrides: {
		service?: WorkerServiceConfig
		workerServices?: Record<string, WorkerServiceConfig>
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
	workerServices: overrides.workerServices ?? {},
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

	it('injects a <NAME>_URL for every routed peer and none for an internal one', () => {
		expect(
			buildWorkerVars(
				input({
					service: API_WORKER,
					workerServices: PROJECT_WORKERS,
				}),
			),
		).toEqual({
			SITE_URL: 'https://example.com',
			WEB_URL: 'https://example.com',
			ADMIN_URL: 'https://admin.example.com',
		})
	})

	it('resolves peer URLs to the dev hostname in development', () => {
		expect(
			buildWorkerVars(
				input({
					service: API_WORKER,
					workerServices: PROJECT_WORKERS,
					environment: 'development',
				}),
			)['ADMIN_URL'],
		).toBe('https://dev.admin.example.com')
	})

	it('injects a routed worker its own URL - the block is symmetric', () => {
		expect(
			buildWorkerVars(
				input({
					service: WEB_WORKER,
					workerServices: PROJECT_WORKERS,
				}),
			)['WEB_URL'],
		).toBe('https://example.com')
	})

	it('injects no peer URL when no service declares one', () => {
		expect(
			buildWorkerVars(
				input({ workerServices: { api: worker(), jobs: worker() } }),
			),
		).toEqual({ SITE_URL: 'https://example.com' })
	})

	it('throws when a service name claims the infra-injected SITE_URL', () => {
		expect(() =>
			buildWorkerVars(
				input({
					workerServices: { site: worker({ url: 'example.com' }) },
				}),
			),
		).toThrow(
			'env key "SITE_URL" collides between two services on the public channel',
		)
	})

	it('injects no backing env for a worker that declares no needs', () => {
		expect(
			buildWorkerVars(
				input({
					service: worker({ url: 'example.com' }),
					backing: FULL_BACKING,
					outputs: FULL_OUTPUTS,
				}),
			),
		).toEqual({ SITE_URL: 'https://example.com' })
	})

	it('injects only the D1 backing env for a worker that needs d1', () => {
		expect(
			buildWorkerVars(
				input({
					service: worker({ needs: ['d1'] }),
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
		expect(
			buildWorkerVars(
				input({
					service: worker({ needs: ['kv'] }),
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
		expect(
			buildWorkerVars(
				input({
					service: worker({ needs: ['r2'] }),
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
		expect(
			buildWorkerVars(
				input({
					service: worker({ needs: ['d1', 'queues'] }),
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

	it('keeps SITE_URL from the project domain regardless of the service url', () => {
		expect(
			buildWorkerVars(
				input({
					projectDomain: 'example.com',
					service: worker({ url: 'other.example.com' }),
				}),
			)['SITE_URL'],
		).toBe('https://example.com')
	})
})
