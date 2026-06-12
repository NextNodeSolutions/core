import { randomBytes } from 'node:crypto'

import { createEnvSecretsAdapter } from '#/adapters/github/env-secrets.ts'
import { loadR2Service } from '#/cli/services/r2/load.ts'
import { POSTGRES_EXPORTER_PASSWORD_ENV } from '#/domain/services/postgres-exporter.ts'
import { signSupabaseJwt } from '#/domain/services/supabase-jwt.ts'
import {
	SUPABASE_DASHBOARD_USERNAME,
	SUPABASE_JWT_EXPIRY_SECONDS,
	SUPABASE_KONG_HTTP_PORT,
	buildSupabaseBackupEnv,
} from '#/domain/services/supabase.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { EnvSecretsAdapter } from '#/adapters/github/env-secrets.ts'
import type {
	Service,
	ServiceDefinition,
	ServiceFactoryContext,
} from '#/cli/services/service.ts'
import type { InfraStorageRuntimeConfig } from '#/domain/cloudflare/r2/runtime-config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'

const logger = createLogger()

const PASSWORD_BYTES = 32

// GitHub repo + pipeline environment a secret is scoped to. These three always
// travel together, so they pass as one value rather than three params.
export interface SecretScope {
	readonly owner: string
	readonly repo: string
	readonly environment: AppEnvironment
}

/**
 * Pinned `iat` for the derived ANON_KEY / SERVICE_ROLE_KEY JWTs. Using a
 * fixed epoch (not `Date.now()`) makes both keys deterministic functions
 * of `JWT_SECRET`, so a re-render of `.env` across deploys yields the
 * exact same tokens - clients caching the key do not see spurious churn.
 */
const SUPABASE_DERIVED_KEY_IAT = 0

export function generatePgExporterPassword(): string {
	return randomBytes(PASSWORD_BYTES).toString('base64')
}

export function generatePostgresPassword(): string {
	return randomBytes(PASSWORD_BYTES).toString('base64')
}

export function generateJwtSecret(): string {
	return randomBytes(PASSWORD_BYTES).toString('base64')
}

/**
 * GitHub env-secrets are scoped per (repo, environment), so the secret
 * name stays a literal (no `_<PROJECT>` suffix) - the repo + env are
 * the isolation boundary. Probe gh, fail loud if unavailable, push one
 * secret.
 */
async function pushEnvSecret(
	name: string,
	secretValue: string,
	scope: SecretScope,
	adapter: EnvSecretsAdapter,
): Promise<void> {
	if (!(await adapter.ghAvailable())) {
		throw new Error(
			`supabase service: gh CLI unavailable - cannot persist "${name}" as a GitHub env secret`,
		)
	}
	await adapter.setRepoEnvSecret(name, secretValue, scope)
}

/**
 * Idempotent provision: if `PG_EXPORTER_PASSWORD` already reached this
 * run through `ALL_SECRETS`, leave it alone; otherwise generate + push as
 * a GitHub env-secret on the project repo, scoped to the current pipeline
 * environment. Skipping on `repoSecrets[name]` (not on a separate gh-list
 * call) keeps the source of truth aligned with what deploy reads - same
 * dict, no drift.
 */
export async function ensurePgExporterPasswordSecret(
	repoSecrets: Readonly<Record<string, string>>,
	scope: SecretScope,
	adapter: EnvSecretsAdapter = createEnvSecretsAdapter(),
): Promise<void> {
	if (repoSecrets[POSTGRES_EXPORTER_PASSWORD_ENV]) {
		logger.info(
			`postgres-exporter password already in ALL_SECRETS (${POSTGRES_EXPORTER_PASSWORD_ENV}) - skipping`,
		)
		return
	}
	await pushEnvSecret(
		POSTGRES_EXPORTER_PASSWORD_ENV,
		generatePgExporterPassword(),
		scope,
		adapter,
	)
	logger.info(
		`postgres-exporter password persisted as env-secret on ${scope.owner}/${scope.repo} (${scope.environment})`,
	)
}

export async function rotatePgExporterPasswordSecret(
	scope: SecretScope,
	adapter: EnvSecretsAdapter = createEnvSecretsAdapter(),
): Promise<void> {
	await pushEnvSecret(
		POSTGRES_EXPORTER_PASSWORD_ENV,
		generatePgExporterPassword(),
		scope,
		adapter,
	)
	logger.info(
		`postgres-exporter password rotated on ${scope.owner}/${scope.repo} (${scope.environment})`,
	)
}

/**
 * Same idempotency contract as `ensurePgExporterPasswordSecret`, but
 * persisted as a GitHub env-secret on the project repo, scoped to the
 * current pipeline environment. The compose `.env` consumes
 * `POSTGRES_PASSWORD` directly; `repoSecrets['POSTGRES_PASSWORD']` is
 * the source of truth at deploy time.
 */
export async function ensurePostgresPasswordSecret(
	repoSecrets: Readonly<Record<string, string>>,
	scope: SecretScope,
	adapter: EnvSecretsAdapter = createEnvSecretsAdapter(),
): Promise<void> {
	if (repoSecrets['POSTGRES_PASSWORD']) {
		logger.info(
			`supabase POSTGRES_PASSWORD already in ALL_SECRETS - skipping`,
		)
		return
	}
	await pushEnvSecret(
		'POSTGRES_PASSWORD',
		generatePostgresPassword(),
		scope,
		adapter,
	)
	logger.info(
		`supabase POSTGRES_PASSWORD persisted as env-secret on ${scope.owner}/${scope.repo} (${scope.environment})`,
	)
}

/**
 * Same idempotency contract as `ensurePostgresPasswordSecret`. JWT_SECRET
 * is the HS256 signing key used by gotrue/realtime/storage and to derive
 * ANON_KEY / SERVICE_ROLE_KEY at deploy time - must stay stable across
 * deploys, hence the skip-on-present check is load-bearing (rotating
 * would invalidate every signed token).
 */
export async function ensureJwtSecret(
	repoSecrets: Readonly<Record<string, string>>,
	scope: SecretScope,
	adapter: EnvSecretsAdapter = createEnvSecretsAdapter(),
): Promise<void> {
	if (repoSecrets['JWT_SECRET']) {
		logger.info(`supabase JWT_SECRET already in ALL_SECRETS - skipping`)
		return
	}
	await pushEnvSecret('JWT_SECRET', generateJwtSecret(), scope, adapter)
	logger.info(
		`supabase JWT_SECRET persisted as env-secret on ${scope.owner}/${scope.repo} (${scope.environment})`,
	)
}

/**
 * DASHBOARD_PASSWORD is a human credential: the operator types it in the
 * browser to log into Supabase Studio behind Caddy basic auth. GitHub
 * env-secrets are write-only, so auto-generating it would lock the
 * operator out of their own dashboard. Instead we require the user to
 * set it themselves (as a repo env-secret) and fail loud at provision
 * time if it's missing - earlier feedback than a silent deploy miss.
 */
export function requireDashboardPasswordSecret(
	repoSecrets: Readonly<Record<string, string>>,
	scope: SecretScope,
): void {
	if (!repoSecrets['DASHBOARD_PASSWORD']) {
		throw new Error(
			`supabase service: env-secret "DASHBOARD_PASSWORD" must be set on ${scope.owner}/${scope.repo} for the "${scope.environment}" environment - this is the human admin password for Supabase Studio and must be chosen by the operator. Set it with: gh secret set DASHBOARD_PASSWORD --repo ${scope.owner}/${scope.repo} --env ${scope.environment}`,
		)
	}
	logger.info(`supabase DASHBOARD_PASSWORD present in ALL_SECRETS`)
}

export function createSupabaseService(ctx: ServiceFactoryContext): Service {
	if (ctx.infraStorage === null) {
		throw new Error(
			'supabase service: infra storage (R2 state bucket) must be loaded by the caller - supabase reads the R2 service state to derive BACKUP_R2_* env vars for the pg_dump sidecar',
		)
	}
	const { infraStorage } = ctx
	return {
		name: 'supabase',
		async provision(): Promise<void> {
			const scope: SecretScope = {
				owner: ctx.repository.owner,
				repo: ctx.repository.name,
				environment: ctx.environment,
			}
			await ensurePgExporterPasswordSecret(ctx.repoSecrets, scope)
			await ensurePostgresPasswordSecret(ctx.repoSecrets, scope)
			await ensureJwtSecret(ctx.repoSecrets, scope)
			requireDashboardPasswordSecret(ctx.repoSecrets, scope)
		},
		loadEnv: () => loadSupabaseEnv(ctx, infraStorage),
	}
}

const REQUIRED_SUPABASE_SECRETS: ReadonlyArray<string> = [
	POSTGRES_EXPORTER_PASSWORD_ENV,
	'POSTGRES_PASSWORD',
	'JWT_SECRET',
	'DASHBOARD_PASSWORD',
]

// Pull the operator/auto-generated secrets out of ALL_SECRETS, failing loud
// (with the provision-then-redeploy runbook) when any is still absent.
function collectSupabaseSecrets(
	repoSecrets: Readonly<Record<string, string>>,
): Record<string, string> {
	const secret: Record<string, string> = {}
	const missing: string[] = []
	for (const name of REQUIRED_SUPABASE_SECRETS) {
		const secretValue = repoSecrets[name]
		if (secretValue === undefined || secretValue === '') {
			missing.push(name)
			continue
		}
		secret[name] = secretValue
	}
	if (missing.length > 0) {
		throw new Error(
			`supabase service: the following GitHub secrets must be in ALL_SECRETS before deploy can render the supabase compose .env: ${missing.join(', ')} - run "provision" first so the auto-generated ones are pushed and the operator-set DASHBOARD_PASSWORD is verified, then re-trigger the deploy workflow so ALL_SECRETS picks them up`,
		)
	}
	return secret
}

// Derive the ANON_KEY / SERVICE_ROLE_KEY JWTs from JWT_SECRET (deterministic,
// pinned iat).
function deriveSupabaseKeys(jwtSecret: string): Record<string, string> {
	return {
		ANON_KEY: signSupabaseJwt(
			{ role: 'anon', iss: 'supabase', iat: SUPABASE_DERIVED_KEY_IAT },
			jwtSecret,
		),
		SERVICE_ROLE_KEY: signSupabaseJwt(
			{
				role: 'service_role',
				iss: 'supabase',
				iat: SUPABASE_DERIVED_KEY_IAT,
			},
			jwtSecret,
		),
	}
}

// `api.<domain>` is the NextNode convention for the kong API gateway vhost:
// app traffic stays on `<domain>`, the supabase REST + auth + storage +
// realtime entrypoints sit behind `api.<domain>`, and Studio (the admin UI)
// is fronted by Caddy basic auth on a separate vhost (see P7-11).
function buildSupabasePublicEnv(
	projectName: string,
	deployDomain: string,
): Record<string, string> {
	return {
		KONG_HTTP_PORT: String(SUPABASE_KONG_HTTP_PORT),
		JWT_EXPIRY: String(SUPABASE_JWT_EXPIRY_SECONDS),
		DASHBOARD_USERNAME: SUPABASE_DASHBOARD_USERNAME,
		STUDIO_DEFAULT_ORGANIZATION: projectName,
		STUDIO_DEFAULT_PROJECT: projectName,
		POOLER_TENANT_ID: projectName,
		API_EXTERNAL_URL: `https://api.${deployDomain}`,
		SITE_URL: `https://${deployDomain}`,
	}
}

async function loadSupabaseEnv(
	ctx: ServiceFactoryContext,
	infraStorage: InfraStorageRuntimeConfig,
): Promise<ServiceEnv> {
	const collected = collectSupabaseSecrets(ctx.repoSecrets)
	const jwtSecret = collected['JWT_SECRET']
	if (jwtSecret === undefined) {
		throw new Error('supabase service: JWT_SECRET missing after collection')
	}
	const secret: Record<string, string> = {
		...collected,
		...deriveSupabaseKeys(jwtSecret),
	}

	if (ctx.deployDomain === null) {
		throw new Error(
			"supabase service: project.domain must be set in nextnode.toml - supabase bakes the resolved domain into gotrue's API_EXTERNAL_URL (magic-link / OAuth callback host) and SITE_URL (default redirect target), so a missing domain breaks the entire auth flow at runtime",
		)
	}

	const r2State = await loadR2Service({
		infraStorage,
		projectName: ctx.projectName,
		environment: ctx.environment,
	})
	Object.assign(secret, buildSupabaseBackupEnv(r2State))

	return {
		public: buildSupabasePublicEnv(ctx.projectName, ctx.deployDomain),
		secret,
	}
}

export const supabaseServiceDefinition: ServiceDefinition<'supabase'> = {
	name: 'supabase',
	build(services, ctx) {
		if (services.supabase === undefined) return null
		return createSupabaseService(ctx)
	},
}
