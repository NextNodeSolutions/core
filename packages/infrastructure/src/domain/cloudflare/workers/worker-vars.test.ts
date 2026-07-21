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

	it('never injects a peer <NAME>_URL - worker-to-worker goes through the service binding, not a URL', () => {
		expect(
			buildWorkerVars(input({ service: worker({ url: 'example.com' }) })),
		).toEqual({ SITE_URL: 'https://example.com' })
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
