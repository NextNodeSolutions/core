import { ensureR2Bucket } from '#/adapters/cloudflare/r2/buckets.ts'
import { R2_BUCKET_LOCATION_HINT } from '#/config/types.ts'
import { postgresWalgBucketName } from '#/domain/services/postgres-walg.ts'
import {
	buildPostgresEmbeddedEnv,
	buildPostgresExternalEnv,
} from '#/domain/services/postgres.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type {
	Service,
	ServiceDefinition,
	ServiceFactoryContext,
} from '#/cli/services/service.ts'
import type { PostgresServiceConfig } from '#/config/types.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'

const logger = createLogger()

export const POSTGRES_PASSWORD_SECRET = 'POSTGRES_PASSWORD'
export const POSTGRES_DATABASE_URL_SECRET = 'DATABASE_URL'

export function createPostgresService(
	ctx: ServiceFactoryContext,
	config: PostgresServiceConfig,
): Service {
	if (config.mode === 'external') {
		return {
			name: 'postgres',
			provision: async (): Promise<void> => {},
			loadEnv: async (): Promise<ServiceEnv> =>
				Promise.resolve(loadPostgresEnv(ctx, config)),
		}
	}

	if (ctx.infraStorage === null) {
		throw new Error(
			'postgres service (embedded mode): infra storage (state bucket) must be loaded by the caller - caller invariant broken',
		)
	}
	const { accountId } = ctx.infraStorage
	return {
		name: 'postgres',
		async provision(): Promise<void> {
			const bucketName = postgresWalgBucketName(ctx.projectName)
			await ensureR2Bucket({
				token: ctx.cfToken,
				accountId,
				bucketName,
				locationHint: R2_BUCKET_LOCATION_HINT,
			})
			logger.info(`wal-g backup bucket ${bucketName} provisioned`)
		},
		loadEnv: async (): Promise<ServiceEnv> =>
			Promise.resolve(loadPostgresEnv(ctx, config)),
	}
}

function loadPostgresEnv(
	ctx: ServiceFactoryContext,
	config: PostgresServiceConfig,
): ServiceEnv {
	if (config.mode === 'embedded') {
		const password = ctx.repoSecrets[POSTGRES_PASSWORD_SECRET]
		if (password === undefined || password === '') {
			throw new Error(
				`postgres service (embedded mode): "${POSTGRES_PASSWORD_SECRET}" must be defined in repository secrets so the sidecar can be initialised and the app can connect`,
			)
		}
		return buildPostgresEmbeddedEnv(ctx.projectName, password)
	}

	const databaseUrl = ctx.repoSecrets[POSTGRES_DATABASE_URL_SECRET]
	if (databaseUrl === undefined || databaseUrl === '') {
		throw new Error(
			`postgres service (external mode): "${POSTGRES_DATABASE_URL_SECRET}" must be defined in repository secrets pointing at the managed database`,
		)
	}
	return buildPostgresExternalEnv(databaseUrl)
}

export const postgresServiceDefinition: ServiceDefinition<'postgres'> = {
	name: 'postgres',
	build(services, ctx) {
		const config = services.postgres
		if (config === undefined) return null
		return createPostgresService(ctx, config)
	},
}
