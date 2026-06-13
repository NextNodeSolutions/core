import { ensureR2Bucket } from '#/adapters/cloudflare/r2/buckets.ts'
import { R2_BUCKET_LOCATION_HINT } from '#/config/types.ts'
import { buildPostgresBackupCredsEnv } from '#/domain/services/postgres-backup.ts'
import { postgresWalgBucketName } from '#/domain/services/postgres-walg.ts'
import {
	buildPostgresEmbeddedEnv,
	buildPostgresExternalEnv,
} from '#/domain/services/postgres.ts'
import { mergeServiceEnvs } from '#/domain/services/service.ts'
import { createLogger } from '@nextnode-solutions/logger'

import {
	POSTGRES_PASSWORD_SECRET,
	ensureEmbeddedPostgresPasswordSecret,
} from './ensure-password.ts'
import {
	loadPostgresBackupCreds,
	provisionPostgresBackupCreds,
} from './postgres-backup-creds.ts'

import type { RepoEnvScope } from '#/adapters/github/env-secrets.ts'
import type {
	Service,
	ServiceDefinition,
	ServiceFactoryContext,
} from '#/cli/services/service.ts'
import type { PostgresServiceConfig } from '#/config/types.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
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
				loadExternalPostgresEnv(ctx),
		}
	}

	if (ctx.infraStorage === null) {
		throw new Error(
			'postgres service (embedded mode): infra storage (state bucket) must be loaded by the caller - caller invariant broken',
		)
	}
	const { infraStorage } = ctx
	// wal-g archives the base backups + WAL here; the bucket is provisioned and
	// accessed with a dedicated, infra-owned R2 token scoped to it alone.
	const bucketName = postgresWalgBucketName(ctx.projectName)
	return {
		name: 'postgres',
		async provision(): Promise<void> {
			const scope: RepoEnvScope = {
				owner: ctx.repository.owner,
				repo: ctx.repository.name,
				environment: ctx.environment,
			}
			await ensureEmbeddedPostgresPasswordSecret(ctx.repoSecrets, scope)

			await ensureR2Bucket({
				token: ctx.cfToken,
				accountId: infraStorage.accountId,
				bucketName,
				locationHint: R2_BUCKET_LOCATION_HINT,
			})
			logger.info(`wal-g backup bucket ${bucketName} provisioned`)
			// wal-g authenticates to that bucket with a dedicated R2 token scoped
			// to it alone (infra-owned, NOT the app `[services.r2]` creds) - so a
			// leak of the app creds can never reach the backups, and vice versa.
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
			`postgres service (embedded mode): "${POSTGRES_PASSWORD_SECRET}" is missing from ALL_SECRETS. It is auto-generated at provision (alphanumeric, safe to interpolate into the initdb SQL + DATABASE_URL), but GitHub freezes secrets at job start - run "provision" first so it is pushed, then re-trigger the deploy workflow so ALL_SECRETS picks it up`,
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
