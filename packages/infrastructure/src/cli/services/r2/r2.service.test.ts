import type { ServiceFactoryContext } from '#/cli/services/service.ts'
import type { R2ServiceConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { R2ServiceState } from '#/domain/services/r2.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ensureMock = vi.hoisted(() => vi.fn())
const loadMock = vi.hoisted(() => vi.fn())

vi.mock('./ensure.ts', () => ({ ensureR2Service: ensureMock }))
vi.mock('./load.ts', () => ({ loadR2Service: loadMock }))

import { createR2Service, r2ServiceDefinition } from './r2.service.ts'

const INFRA_STORAGE: InfraStorageRuntimeConfig = {
	accountId: 'acct-123',
	endpoint: 'https://r2.example.com',
	accessKeyId: 'infra-ak',
	secretAccessKey: 'infra-sk',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
}

const CTX: ServiceFactoryContext = {
	projectName: 'myapp',
	environment: 'production',
	cfToken: 'cf-token',
	infraStorage: INFRA_STORAGE,
}

const CONFIG: R2ServiceConfig = {
	buckets: ['uploads', 'media'],
}

const STATE: R2ServiceState = {
	endpoint: 'https://acct-123.r2.cloudflarestorage.com',
	accessKeyId: 'svc-ak',
	secretAccessKey: 'svc-sk',
	buckets: [
		{ alias: 'uploads', name: 'myapp-production-uploads' },
		{ alias: 'media', name: 'myapp-production-media' },
	],
}

afterEach(() => {
	vi.clearAllMocks()
})

describe('createR2Service', () => {
	it('exposes the service under the "r2" name', () => {
		const service = createR2Service(CTX, CONFIG)
		expect(service.name).toBe('r2')
	})

	it('forwards every input field to ensureR2Service on provision()', async () => {
		ensureMock.mockResolvedValue(STATE)
		const service = createR2Service(CTX, CONFIG)

		await service.provision()

		expect(ensureMock).toHaveBeenCalledTimes(1)
		expect(ensureMock).toHaveBeenCalledWith({
			cfToken: 'cf-token',
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
			bucketAliases: ['uploads', 'media'],
		})
	})

	it('passes only the load-relevant subset of inputs to loadR2Service on loadEnv()', async () => {
		loadMock.mockResolvedValue(STATE)
		const service = createR2Service(CTX, CONFIG)

		await service.loadEnv()

		expect(loadMock).toHaveBeenCalledTimes(1)
		expect(loadMock).toHaveBeenCalledWith({
			infraStorage: INFRA_STORAGE,
			projectName: 'myapp',
			environment: 'production',
		})
	})

	it('projects the loaded state to the public + secret env channels', async () => {
		loadMock.mockResolvedValue(STATE)
		const service = createR2Service(CTX, CONFIG)

		const env = await service.loadEnv()

		expect(env).toEqual({
			public: {
				R2_ENDPOINT: 'https://acct-123.r2.cloudflarestorage.com',
				R2_BUCKET_UPLOADS: 'myapp-production-uploads',
				R2_BUCKET_MEDIA: 'myapp-production-media',
			},
			secret: {
				R2_ACCESS_KEY_ID: 'svc-ak',
				R2_SECRET_ACCESS_KEY: 'svc-sk',
			},
		})
	})

	it('propagates ensure failures from provision()', async () => {
		ensureMock.mockRejectedValue(new Error('cloudflare exploded'))
		const service = createR2Service(CTX, CONFIG)

		await expect(service.provision()).rejects.toThrow('cloudflare exploded')
	})

	it('propagates load failures from loadEnv()', async () => {
		loadMock.mockRejectedValue(new Error('state missing'))
		const service = createR2Service(CTX, CONFIG)

		await expect(service.loadEnv()).rejects.toThrow('state missing')
	})

	it('throws when infra storage is missing — every R2 op needs the state bucket', () => {
		expect(() =>
			createR2Service({ ...CTX, infraStorage: null }, CONFIG),
		).toThrow(
			'r2 service: infra storage (state bucket) must be loaded by the caller — caller invariant broken',
		)
	})
})

describe('r2ServiceDefinition', () => {
	it('returns null when [services.r2] is not declared', () => {
		expect(r2ServiceDefinition.build({}, CTX)).toBeNull()
	})

	it('builds the R2 service when [services.r2] is declared', () => {
		const service = r2ServiceDefinition.build({ r2: CONFIG }, CTX)
		expect(service?.name).toBe('r2')
	})

	it('propagates the missing-infra-storage precondition from createR2Service', () => {
		expect(() =>
			r2ServiceDefinition.build(
				{ r2: CONFIG },
				{ ...CTX, infraStorage: null },
			),
		).toThrow(
			'r2 service: infra storage (state bucket) must be loaded by the caller — caller invariant broken',
		)
	})
})
