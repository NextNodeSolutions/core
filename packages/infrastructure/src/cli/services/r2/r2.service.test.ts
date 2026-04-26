import { afterEach, describe, expect, it, vi } from 'vitest'

import type { R2RuntimeConfig } from '@/domain/cloudflare/r2/runtime-config.ts'
import type { R2ServiceState } from '@/domain/services/r2.ts'

const ensureMock = vi.hoisted(() => vi.fn())
const loadMock = vi.hoisted(() => vi.fn())

vi.mock('./ensure.ts', () => ({ ensureR2Service: ensureMock }))
vi.mock('./load.ts', () => ({ loadR2Service: loadMock }))

import { createR2Service } from './r2.service.ts'

const INFRA_R2: R2RuntimeConfig = {
	accountId: 'acct-123',
	endpoint: 'https://r2.example.com',
	accessKeyId: 'infra-ak',
	secretAccessKey: 'infra-sk',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
}

const FACTORY_INPUT = {
	cfToken: 'cf-token',
	infraR2: INFRA_R2,
	projectName: 'myapp',
	environment: 'production',
	bucketAliases: ['uploads', 'media'],
} as const

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
		const service = createR2Service(FACTORY_INPUT)
		expect(service.name).toBe('r2')
	})

	it('forwards every input field to ensureR2Service on provision()', async () => {
		ensureMock.mockResolvedValue(STATE)
		const service = createR2Service(FACTORY_INPUT)

		await service.provision()

		expect(ensureMock).toHaveBeenCalledTimes(1)
		expect(ensureMock).toHaveBeenCalledWith({
			cfToken: 'cf-token',
			infraR2: INFRA_R2,
			projectName: 'myapp',
			environment: 'production',
			bucketAliases: ['uploads', 'media'],
		})
	})

	it('passes only the load-relevant subset of inputs to loadR2Service on loadEnv()', async () => {
		loadMock.mockResolvedValue(STATE)
		const service = createR2Service(FACTORY_INPUT)

		await service.loadEnv()

		expect(loadMock).toHaveBeenCalledTimes(1)
		expect(loadMock).toHaveBeenCalledWith({
			infraR2: INFRA_R2,
			projectName: 'myapp',
			environment: 'production',
		})
	})

	it('projects the loaded state to the public + secret env channels', async () => {
		loadMock.mockResolvedValue(STATE)
		const service = createR2Service(FACTORY_INPUT)

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
		const service = createR2Service(FACTORY_INPUT)

		await expect(service.provision()).rejects.toThrow('cloudflare exploded')
	})

	it('propagates load failures from loadEnv()', async () => {
		loadMock.mockRejectedValue(new Error('state missing'))
		const service = createR2Service(FACTORY_INPUT)

		await expect(service.loadEnv()).rejects.toThrow('state missing')
	})
})
