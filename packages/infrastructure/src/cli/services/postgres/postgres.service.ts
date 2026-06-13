import { ensureR2Bucket } from '#/adapters/cloudflare/r2/buckets.ts'
import { R2_BUCKET_LOCATION_HINT } from '#/config/types.ts'
import { postgresWalgBucketName } from '#/domain/services/postgres-walg.ts'
import {
	buildPostgresEmbeddedEnv,
	buildPostgresExternalEnv,
} from '#/domain/services/postgres.ts'
import { createLogger } from '@nextnode-solutions/logger'

import {
	POSTGRES_PASSWORD_SECRET,
	ensureEmbeddedPostgresPasswordSecret,
} from './ensure-password.ts'

import type {
	Service,
	ServiceDefinition,
	ServiceFactoryContext,
} from '#/cli/services/service.ts'
import type { RepoEnvScope } from '#/adapters/github/env-secrets.ts'
import type { PostgresServiceConfig } from '#/config/types.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'

const logger = createLogger()

export { POSTGRES_PASSWORD_SECRET }
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
			const scope: RepoEnvScope = {
				owner: ctx.repository.owner,
				repo: ctx.repository.name,
				environment: ctx.environment,
			}
			await ensureEmbeddedPostgresPasswordSecret(ctx.repoSecrets, scope)

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
				`postgres service (embedded mode): "${POSTGRES_PASSWORD_SECRET}" is missing from ALL_SECRETS. It is auto-generated at provision (alphanumeric, safe to interpolate into the initdb SQL + DATABASE_URL), but GitHub freezes secrets at job start - run "provision" first so it is pushed, then re-trigger the deploy workflow so ALL_SECRETS picks it up`,
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
