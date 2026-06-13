import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ServiceFactoryContext } from '#/cli/services/service.ts'
import type { PostgresServiceConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'

const ensureR2BucketMock = vi.hoisted(() => vi.fn())
const provisionPostgresBackupCredsMock = vi.hoisted(() => vi.fn())
const loadPostgresBackupCredsMock = vi.hoisted(() => vi.fn())

vi.mock('#/adapters/cloudflare/r2/buckets.ts', () => ({
	ensureR2Bucket: ensureR2BucketMock,
}))

vi.mock('./postgres-backup-creds.ts', () => ({
	provisionPostgresBackupCreds: provisionPostgresBackupCredsMock,
	loadPostgresBackupCreds: loadPostgresBackupCredsMock,
}))

// CRITICAL: embedded provision() auto-generates POSTGRES_PASSWORD via the real
// gh CLI by default. Stub the env-secrets adapter so this suite can NEVER run
// `gh secret set` against a live repo (that would overwrite a production
// secret). The password-ensure logic itself is covered in ensure-password.test.ts.
vi.mock('#/adapters/github/env-secrets.ts', () => ({
	createEnvSecretsAdapter: () => ({
		ghAvailable: () => Promise.resolve(true),
		setRepoEnvSecret: () => Promise.resolve(),
	}),
}))

const BACKUP_CREDS = {
	endpoint: 'https://acct.r2.cloudflarestorage.com',
	accessKeyId: 'bk-key',
	secretAccessKey: 'bk-secret',
}

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

		it('provisions a dedicated R2 token scoped to the backup bucket', async () => {
			ensureR2BucketMock.mockResolvedValue(true)
			const service = createPostgresService(makeCtx(), EMBEDDED)

			await service.provision()

			expect(provisionPostgresBackupCredsMock).toHaveBeenCalledTimes(1)
			expect(provisionPostgresBackupCredsMock).toHaveBeenCalledWith({
				cfToken: 'cf-token',
				infraStorage: INFRA_STORAGE,
				projectName: 'myapp',
				environment: 'production',
				bucketName: 'nn-walg-myapp',
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
		it('merges the connection env with the infra-owned backup R2 creds', async () => {
			loadPostgresBackupCredsMock.mockResolvedValue(BACKUP_CREDS)
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
					POSTGRES_BACKUP_R2_ACCESS_KEY_ID: 'bk-key',
					POSTGRES_BACKUP_R2_SECRET_ACCESS_KEY: 'bk-secret',
					POSTGRES_BACKUP_R2_ENDPOINT:
						'https://acct.r2.cloudflarestorage.com',
				},
			})
			expect(loadPostgresBackupCredsMock).toHaveBeenCalledWith({
				infraStorage: INFRA_STORAGE,
				projectName: 'myapp',
				environment: 'production',
			})
		})

		it('throws when POSTGRES_PASSWORD is not set in repository secrets', async () => {
			const service = createPostgresService(makeCtx({}), EMBEDDED)

			await expect(service.loadEnv()).rejects.toThrow(
				'postgres service (embedded mode): "POSTGRES_PASSWORD" is missing from ALL_SECRETS',
			)
		})

		it('throws when POSTGRES_PASSWORD is set to an empty string', async () => {
			const service = createPostgresService(
				makeCtx({ POSTGRES_PASSWORD: '' }),
				EMBEDDED,
			)

			await expect(service.loadEnv()).rejects.toThrow(
				'postgres service (embedded mode): "POSTGRES_PASSWORD" is missing from ALL_SECRETS',
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
