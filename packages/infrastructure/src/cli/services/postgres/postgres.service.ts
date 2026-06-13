import { ensureR2Bucket } from '#/adapters/cloudflare/r2/buckets.ts'
import { R2_BUCKET_LOCATION_HINT } from '#/config/types.ts'
import { buildPostgresBackupCredsEnv } from '#/domain/services/postgres-backup.ts'
import {
	buildPostgresEmbeddedEnv,
	buildPostgresExternalEnv,
	postgresBackupBucketName,
} from '#/domain/services/postgres.ts'
import { mergeServiceEnvs } from '#/domain/services/service.ts'
import { createLogger } from '@nextnode-solutions/logger'

import {
	loadPostgresBackupCreds,
	provisionPostgresBackupCreds,
} from './postgres-backup-creds.ts'

import type {
	Service,
	ServiceDefinition,
	ServiceFactoryContext,
} from '#/cli/services/service.ts'
import type { PostgresServiceConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
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
				loadExternalPostgresEnv(ctx),
		}
	}

	if (ctx.infraStorage === null) {
		throw new Error(
			'postgres service (embedded mode): infra storage (state bucket) must be loaded by the caller - caller invariant broken',
		)
	}
	const { infraStorage } = ctx
	const bucketName = postgresBackupBucketName(ctx.projectName)
	return {
		name: 'postgres',
		async provision(): Promise<void> {
			await ensureR2Bucket({
				token: ctx.cfToken,
				accountId: infraStorage.accountId,
				bucketName,
				locationHint: R2_BUCKET_LOCATION_HINT,
			})
			logger.info(`postgres backup bucket ${bucketName} provisioned`)
			// The backup sidecar authenticates to that bucket with a dedicated
			// R2 token scoped to it alone (infra-owned, NOT the app `[services.r2]`).
			await provisionPostgresBackupCreds({
				cfToken: ctx.cfToken,
				infraStorage,
				projectName: ctx.projectName,
				environment: ctx.environment,
				bucketName,
			})
		},
		loadEnv: async (): Promise<ServiceEnv> =>
			loadEmbeddedPostgresEnv(ctx, infraStorage),
	}
}

async function loadEmbeddedPostgresEnv(
	ctx: ServiceFactoryContext,
	infraStorage: InfraStorageRuntimeConfig,
): Promise<ServiceEnv> {
	const password = ctx.repoSecrets[POSTGRES_PASSWORD_SECRET]
	if (password === undefined || password === '') {
		throw new Error(
			`postgres service (embedded mode): "${POSTGRES_PASSWORD_SECRET}" must be defined in repository secrets so the sidecar can be initialised and the app can connect`,
		)
	}
	const backupCreds = await loadPostgresBackupCreds({
		infraStorage,
		projectName: ctx.projectName,
		environment: ctx.environment,
	})
	return mergeServiceEnvs([
		buildPostgresEmbeddedEnv(ctx.projectName, password),
		buildPostgresBackupCredsEnv(backupCreds),
	])
}

function loadExternalPostgresEnv(ctx: ServiceFactoryContext): ServiceEnv {
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
