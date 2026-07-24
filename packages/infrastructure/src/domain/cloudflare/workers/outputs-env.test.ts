import { describe, expect, it } from 'vitest'

import {
	buildWorkersBackingEnv,
	deriveWorkersBackingConfig,
	hasWorkersBacking,
	parseTerraformOutputs,
} from './outputs-env.ts'

import type { ServicesConfig } from '#/config/service-config.ts'
import type { WorkersBackingConfig } from './outputs-env.ts'

const FULL_RAW = {
	d1_database_id: { value: 'db-uuid', type: 'string', sensitive: false },
	kv_namespace_ids: { value: { sessions: 'ns-1', 'edge-cache': 'ns-2' } },
	queue_ids: { value: { jobs: 'q-1' } },
	r2_buckets: { value: { assets: 'my-worker-production-assets' } },
	r2_cdn_urls: { value: { assets: 'https://assets.cdn.example.com' } },
}

const FULL_BACKING: WorkersBackingConfig = {
	hasD1: true,
	hasPlanetscale: false,
	kvAliases: ['sessions', 'edge-cache'],
	queueAliases: ['jobs'],
	bucketAliases: ['assets'],
	cdnBucketAliases: ['assets'],
}

describe('parseTerraformOutputs', () => {
	it('narrows scalar + map outputs from the raw envelope', () => {
		expect(parseTerraformOutputs(FULL_RAW)).toEqual({
			d1DatabaseId: 'db-uuid',
			kvNamespaceIds: { sessions: 'ns-1', 'edge-cache': 'ns-2' },
			queueIds: { jobs: 'q-1' },
			r2Buckets: { assets: 'my-worker-production-assets' },
			r2CdnUrls: { assets: 'https://assets.cdn.example.com' },
		})
	})

	it('leaves absent outputs as empty maps and an omitted d1 id', () => {
		expect(parseTerraformOutputs({})).toEqual({
			kvNamespaceIds: {},
			queueIds: {},
			r2Buckets: {},
			r2CdnUrls: {},
		})
	})

	it('throws when an output entry is missing its value field', () => {
		expect(() =>
			parseTerraformOutputs({ d1_database_id: { type: 'string' } }),
		).toThrow(
			'terraform output "d1_database_id": entry is missing a "value"',
		)
	})

	it('throws when a scalar output is not a string', () => {
		expect(() =>
			parseTerraformOutputs({ d1_database_id: { value: 42 } }),
		).toThrow('terraform output "d1_database_id": expected a string value')
	})

	it('throws when a map output is not an object', () => {
		expect(() =>
			parseTerraformOutputs({ kv_namespace_ids: { value: 'nope' } }),
		).toThrow(
			'terraform output "kv_namespace_ids": expected an object value',
		)
	})

	it('throws when a map entry is not a string', () => {
		expect(() =>
			parseTerraformOutputs({ queue_ids: { value: { jobs: 7 } } }),
		).toThrow('terraform output "queue_ids": entry "jobs" is not a string')
	})

	it('narrows the hyperdrive config id when present', () => {
		expect(
			parseTerraformOutputs({
				hyperdrive_config_id: { value: 'hd-uuid' },
			}).hyperdriveConfigId,
		).toBe('hd-uuid')
	})
})

describe('deriveWorkersBackingConfig', () => {
	it('distils declared backing services into aliases + flags', () => {
		const services: ServicesConfig = {
			d1: { migrationsFolder: 'drizzle' },
			kv: { namespaces: [{ name: 'sessions' }] },
			queues: { queues: [{ name: 'jobs' }] },
			r2: {
				buckets: [
					{ name: 'assets', cdn: true },
					{ name: 'private-cache', cdn: false },
				],
			},
		}

		expect(deriveWorkersBackingConfig(services)).toEqual({
			hasD1: true,
			hasPlanetscale: false,
			kvAliases: ['sessions'],
			queueAliases: ['jobs'],
			bucketAliases: ['assets', 'private-cache'],
			cdnBucketAliases: ['assets'],
		})
	})

	it('yields an all-empty config when no backing service is declared', () => {
		const backing = deriveWorkersBackingConfig({})
		expect(backing).toEqual({
			hasD1: false,
			hasPlanetscale: false,
			kvAliases: [],
			queueAliases: [],
			bucketAliases: [],
			cdnBucketAliases: [],
		})
		expect(hasWorkersBacking(backing)).toBe(false)
	})

	it('flags planetscale and drives provisioning', () => {
		const backing = deriveWorkersBackingConfig({ planetscale: {} })
		expect(backing.hasPlanetscale).toBe(true)
		expect(hasWorkersBacking(backing)).toBe(true)
	})
})

describe('hasWorkersBacking', () => {
	it('is true when any backing resource is declared', () => {
		expect(
			hasWorkersBacking({
				hasD1: false,
				hasPlanetscale: false,
				kvAliases: [],
				queueAliases: ['jobs'],
				bucketAliases: [],
				cdnBucketAliases: [],
			}),
		).toBe(true)
	})
})

describe('buildWorkersBackingEnv', () => {
	it('maps every declared output into the public channel with no secrets', () => {
		const env = buildWorkersBackingEnv(
			parseTerraformOutputs(FULL_RAW),
			'acct-123',
			FULL_BACKING,
		)

		expect(env).toEqual({
			public: {
				D1_DATABASE_ID: 'db-uuid',
				KV_NAMESPACE_SESSIONS_ID: 'ns-1',
				KV_NAMESPACE_EDGE_CACHE_ID: 'ns-2',
				QUEUE_JOBS_ID: 'q-1',
				R2_BUCKET_ASSETS: 'my-worker-production-assets',
				R2_BUCKET_ASSETS_URL: 'https://assets.cdn.example.com',
				R2_ENDPOINT: 'https://acct-123.r2.cloudflarestorage.com',
			},
			secret: {},
		})
	})

	it('emits an empty env when nothing is declared', () => {
		const env = buildWorkersBackingEnv(
			parseTerraformOutputs({}),
			'acct-123',
			deriveWorkersBackingConfig({}),
		)
		expect(env).toEqual({ public: {}, secret: {} })
	})

	it('omits R2_ENDPOINT when no bucket is declared', () => {
		const env = buildWorkersBackingEnv(
			parseTerraformOutputs({ d1_database_id: { value: 'db-1' } }),
			'acct-123',
			{
				hasD1: true,
				hasPlanetscale: false,
				kvAliases: [],
				queueAliases: [],
				bucketAliases: [],
				cdnBucketAliases: [],
			},
		)
		expect(env.public).toEqual({ D1_DATABASE_ID: 'db-1' })
	})

	it('throws an actionable error when a declared d1 output is missing', () => {
		expect(() =>
			buildWorkersBackingEnv(parseTerraformOutputs({}), 'acct-123', {
				hasD1: true,
				hasPlanetscale: false,
				kvAliases: [],
				queueAliases: [],
				bucketAliases: [],
				cdnBucketAliases: [],
			}),
		).toThrow(
			/terraform output "d1_database_id" is missing.*infrastructure provision/,
		)
	})

	it('throws an actionable error when a declared kv namespace has no output', () => {
		expect(() =>
			buildWorkersBackingEnv(parseTerraformOutputs({}), 'acct-123', {
				hasD1: false,
				hasPlanetscale: false,
				kvAliases: ['sessions'],
				queueAliases: [],
				bucketAliases: [],
				cdnBucketAliases: [],
			}),
		).toThrow(
			/terraform output "kv_namespace_ids" has no entry for "sessions".*infrastructure provision/,
		)
	})
})
