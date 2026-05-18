import type { ServiceFactoryContext } from '#/cli/services/service.ts'
import type { PostgresServiceConfig } from '#/config/types.ts'
import { describe, expect, it } from 'vitest'

import {
	createPostgresService,
	postgresServiceDefinition,
} from './postgres.service.ts'

function makeCtx(
	repoSecrets: Readonly<Record<string, string>> = {},
): ServiceFactoryContext {
	return {
		projectName: 'myapp',
		environment: 'production',
		cfToken: 'cf-token',
		infraStorage: null,
		repoSecrets,
	}
}

const EMBEDDED: PostgresServiceConfig = {
	mode: 'embedded',
	migrationsFolder: undefined,
}
const EXTERNAL: PostgresServiceConfig = {
	mode: 'external',
	migrationsFolder: undefined,
}

describe('createPostgresService', () => {
	it('exposes the service under the "postgres" name', () => {
		const service = createPostgresService(makeCtx(), EMBEDDED)
		expect(service.name).toBe('postgres')
	})

	it('provision() is a no-op (sidecar comes up via docker compose on deploy)', async () => {
		const service = createPostgresService(makeCtx(), EMBEDDED)
		await expect(service.provision()).resolves.toBeUndefined()
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
