import type {
	Service,
	ServiceDefinition,
	ServiceFactoryContext,
} from '#/cli/services/service.ts'
import type { PostgresServiceConfig } from '#/config/types.ts'
import {
	buildPostgresEmbeddedEnv,
	buildPostgresExternalEnv,
} from '#/domain/services/postgres.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'

export const POSTGRES_PASSWORD_SECRET = 'POSTGRES_PASSWORD'
export const POSTGRES_DATABASE_URL_SECRET = 'DATABASE_URL'

export function createPostgresService(
	ctx: ServiceFactoryContext,
	config: PostgresServiceConfig,
): Service {
	return {
		name: 'postgres',
		// Provisioning lives in P3-05 (migrate command). Embedded sidecar
		// state is created on the VPS at deploy time by docker compose, so
		// there is nothing to ensure here today.
		provision: async (): Promise<void> => {},
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
