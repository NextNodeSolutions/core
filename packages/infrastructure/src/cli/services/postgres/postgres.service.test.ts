import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ServiceFactoryContext } from '#/cli/services/service.ts'
import type { PostgresServiceConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'

const ensureR2BucketMock = vi.hoisted(() => vi.fn())

vi.mock('#/adapters/cloudflare/r2/buckets.ts', () => ({
	ensureR2Bucket: ensureR2BucketMock,
}))

import {
	createPostgresService,
	postgresServiceDefinition,
} from './postgres.service.ts'

const INFRA_STORAGE: InfraStorageRuntimeConfig = {
	accountId: 'acct',
	endpoint: 'https://r2.example.com',
	accessKeyId: 'r2-key',
	secretAccessKey: 'r2-secret',
	stateBucket: 'nextnode-state',
	certsBucket: 'nextnode-certs',
}

function makeCtx(
	repoSecrets: Readonly<Record<string, string>> = {},
	infraStorage: InfraStorageRuntimeConfig | null = INFRA_STORAGE,
): ServiceFactoryContext {
	return {
		projectName: 'myapp',
		environment: 'production',
		repository: { owner: 'NextNodeSolutions', name: 'core' },
		cfToken: 'cf-token',
		infraStorage,
		repoSecrets,
		deployDomain: 'example.com',
	}
}

const EMBEDDED: PostgresServiceConfig = {
	mode: 'embedded',
}
const EXTERNAL: PostgresServiceConfig = {
	mode: 'external',
}

afterEach(() => {
	vi.clearAllMocks()
})

describe('createPostgresService', () => {
	it('exposes the service under the "postgres" name', () => {
		const service = createPostgresService(makeCtx(), EMBEDDED)
		expect(service.name).toBe('postgres')
	})

	it('provision() is a no-op in external mode (managed db is operator-owned)', async () => {
		const service = createPostgresService(makeCtx(), EXTERNAL)

		await service.provision()

		expect(ensureR2BucketMock).not.toHaveBeenCalled()
	})

	describe('provision() - embedded mode', () => {
		it('calls ensureR2Bucket once with the derived wal-g bucket name', async () => {
			ensureR2BucketMock.mockResolvedValue(true)
			const service = createPostgresService(makeCtx(), EMBEDDED)

			await service.provision()

			expect(ensureR2BucketMock).toHaveBeenCalledTimes(1)
			expect(ensureR2BucketMock).toHaveBeenCalledWith({
				token: 'cf-token',
				accountId: 'acct',
				bucketName: 'nn-walg-myapp',
				locationHint: 'weur',
			})
		})

		it('is safe to call multiple times - delegates idempotency to ensureR2Bucket', async () => {
			ensureR2BucketMock
				.mockResolvedValueOnce(true)
				.mockResolvedValueOnce(false)
			const service = createPostgresService(makeCtx(), EMBEDDED)

			await service.provision()
			await service.provision()

			expect(ensureR2BucketMock).toHaveBeenCalledTimes(2)
			expect(ensureR2BucketMock.mock.calls[0]).toEqual([
				{
					token: 'cf-token',
					accountId: 'acct',
					bucketName: 'nn-walg-myapp',
					locationHint: 'weur',
				},
			])
			expect(ensureR2BucketMock.mock.calls[1]).toEqual([
				{
					token: 'cf-token',
					accountId: 'acct',
					bucketName: 'nn-walg-myapp',
					locationHint: 'weur',
				},
			])
		})
	})

	describe('embedded mode', () => {
		it('builds DATABASE_URL from POSTGRES_PASSWORD pointing at the sidecar host', async () => {
			const service = createPostgresService(
				makeCtx({ POSTGRES_PASSWORD: 's3cret' }),
				EMBEDDED,
			)

			const env = await service.loadEnv()

			expect(env).toEqual({
				public: {
					POSTGRES_USER: 'myapp',
					POSTGRES_DB: 'myapp',
				},
				secret: {
					POSTGRES_PASSWORD: 's3cret',
					DATABASE_URL: 'postgres://myapp:s3cret@postgres:5432/myapp',
				},
			})
		})

		it('throws when POSTGRES_PASSWORD is not set in repository secrets', async () => {
			const service = createPostgresService(makeCtx({}), EMBEDDED)

			await expect(service.loadEnv()).rejects.toThrow(
				'postgres service (embedded mode): "POSTGRES_PASSWORD" must be defined in repository secrets',
			)
		})

		it('throws when POSTGRES_PASSWORD is set to an empty string', async () => {
			const service = createPostgresService(
				makeCtx({ POSTGRES_PASSWORD: '' }),
				EMBEDDED,
			)

			await expect(service.loadEnv()).rejects.toThrow(
				'postgres service (embedded mode): "POSTGRES_PASSWORD" must be defined',
			)
		})
	})

	describe('external mode', () => {
		it('threads the user-provided DATABASE_URL through the secret channel', async () => {
			const service = createPostgresService(
				makeCtx({
					DATABASE_URL: 'postgres://user:pw@db.example.com:5432/app',
				}),
				EXTERNAL,
			)

			const env = await service.loadEnv()

			expect(env).toEqual({
				public: {},
				secret: {
					DATABASE_URL: 'postgres://user:pw@db.example.com:5432/app',
				},
			})
		})

		it('throws when DATABASE_URL is not set in repository secrets', async () => {
			const service = createPostgresService(makeCtx({}), EXTERNAL)

			await expect(service.loadEnv()).rejects.toThrow(
				'postgres service (external mode): "DATABASE_URL" must be defined in repository secrets',
			)
		})

		it('throws when DATABASE_URL is set to an empty string', async () => {
			const service = createPostgresService(
				makeCtx({ DATABASE_URL: '' }),
				EXTERNAL,
			)

			await expect(service.loadEnv()).rejects.toThrow(
				'postgres service (external mode): "DATABASE_URL" must be defined',
			)
		})
	})
})

describe('postgresServiceDefinition', () => {
	it('returns null when [services.postgres] is not declared', () => {
		expect(postgresServiceDefinition.build({}, makeCtx())).toBeNull()
	})

	it('builds the postgres service when [services.postgres] is declared', () => {
		const service = postgresServiceDefinition.build(
			{ postgres: EMBEDDED },
			makeCtx({ POSTGRES_PASSWORD: 'pw' }),
		)
		expect(service?.name).toBe('postgres')
	})
})
