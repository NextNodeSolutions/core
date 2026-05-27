import { randomBytes } from 'node:crypto'

import { createEnvSecretsAdapter } from '#/adapters/github/env-secrets.ts'
import type { EnvSecretsAdapter } from '#/adapters/github/env-secrets.ts'
import { createOrgSecretsAdapter } from '#/adapters/github/org-secrets.ts'
import type { OrgSecretsAdapter } from '#/adapters/github/org-secrets.ts'
import { requireEnv } from '#/cli/env.ts'
import type {
	Service,
	ServiceDefinition,
	ServiceFactoryContext,
} from '#/cli/services/service.ts'
import type { AppEnvironment } from '#/domain/environment.ts'
import {
	POSTGRES_EXPORTER_PASSWORD_ENV,
	pgExporterPasswordSecretName,
} from '#/domain/services/postgres-exporter.ts'
import type { ServiceEnv } from '#/domain/services/service.ts'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

const ENV_GITHUB_OWNER = 'GITHUB_REPOSITORY_OWNER'
const PASSWORD_BYTES = 32

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
 * Same shape as `cli/r2/ensure-setup.ts:persistOrgSecrets`: read the org
 * from env, probe gh, push one secret. Kept inline (one call site each
 * for ensure + rotate) rather than added to the adapter interface — the
 * adapter stays a thin wrapper around `gh secret set`.
 */
async function pushOrgSecret(
	name: string,
	value: string,
	adapter: OrgSecretsAdapter,
): Promise<void> {
	const org = requireEnv(ENV_GITHUB_OWNER)
	if (!(await adapter.ghAvailable())) {
		throw new Error(
			'supabase service: gh CLI unavailable — cannot persist the postgres-exporter password as a GitHub org secret',
		)
	}
	await adapter.setOrgSecret(name, value, org)
}

/**
 * GitHub env-secrets are scoped per (repo, environment), so the secret
 * name stays a literal (no `_<PROJECT>` suffix) — the repo + env are
 * the isolation boundary. Symmetric with `pushOrgSecret`: probe gh,
 * fail loud if unavailable, push one secret.
 */
async function pushEnvSecret(
	name: string,
	value: string,
	owner: string,
	repo: string,
	environment: AppEnvironment,
	adapter: EnvSecretsAdapter,
): Promise<void> {
	if (!(await adapter.ghAvailable())) {
		throw new Error(
			`supabase service: gh CLI unavailable — cannot persist "${name}" as a GitHub env secret`,
		)
	}
	await adapter.setRepoEnvSecret(name, value, owner, repo, environment)
}

/**
 * Idempotent provision: if the secret already reached this run through
 * `ALL_SECRETS`, leave it alone; otherwise generate + push. Skipping on
 * `repoSecrets[name]` (not on a separate gh-list call) keeps the source
 * of truth aligned with what deploy reads — same dict, no drift.
 */
export async function ensurePgExporterPasswordSecret(
	projectName: string,
	repoSecrets: Readonly<Record<string, string>>,
	adapter: OrgSecretsAdapter = createOrgSecretsAdapter(),
): Promise<void> {
	const secretName = pgExporterPasswordSecretName(projectName)
	if (repoSecrets[secretName]) {
		logger.info(
			`postgres-exporter password already in ALL_SECRETS (${secretName}) — skipping`,
		)
		return
	}
	await pushOrgSecret(secretName, generatePgExporterPassword(), adapter)
	logger.info(`postgres-exporter password persisted as ${secretName}`)
}

export async function rotatePgExporterPasswordSecret(
	projectName: string,
	adapter: OrgSecretsAdapter = createOrgSecretsAdapter(),
): Promise<void> {
	const secretName = pgExporterPasswordSecretName(projectName)
	await pushOrgSecret(secretName, generatePgExporterPassword(), adapter)
	logger.info(`postgres-exporter password rotated for ${secretName}`)
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
	owner: string,
	repo: string,
	environment: AppEnvironment,
	adapter: EnvSecretsAdapter = createEnvSecretsAdapter(),
): Promise<void> {
	if (repoSecrets['POSTGRES_PASSWORD']) {
		logger.info(
			`supabase POSTGRES_PASSWORD already in ALL_SECRETS — skipping`,
		)
		return
	}
	await pushEnvSecret(
		'POSTGRES_PASSWORD',
		generatePostgresPassword(),
		owner,
		repo,
		environment,
		adapter,
	)
	logger.info(
		`supabase POSTGRES_PASSWORD persisted as env-secret on ${owner}/${repo} (${environment})`,
	)
}

/**
 * Same idempotency contract as `ensurePostgresPasswordSecret`. JWT_SECRET
 * is the HS256 signing key used by gotrue/realtime/storage and to derive
 * ANON_KEY / SERVICE_ROLE_KEY at deploy time — must stay stable across
 * deploys, hence the skip-on-present check is load-bearing (rotating
 * would invalidate every signed token).
 */
export async function ensureJwtSecret(
	repoSecrets: Readonly<Record<string, string>>,
	owner: string,
	repo: string,
	environment: AppEnvironment,
	adapter: EnvSecretsAdapter = createEnvSecretsAdapter(),
): Promise<void> {
	if (repoSecrets['JWT_SECRET']) {
		logger.info(`supabase JWT_SECRET already in ALL_SECRETS — skipping`)
		return
	}
	await pushEnvSecret(
		'JWT_SECRET',
		generateJwtSecret(),
		owner,
		repo,
		environment,
		adapter,
	)
	logger.info(
		`supabase JWT_SECRET persisted as env-secret on ${owner}/${repo} (${environment})`,
	)
}

export function createSupabaseService(ctx: ServiceFactoryContext): Service {
	const secretName = pgExporterPasswordSecretName(ctx.projectName)
	return {
		name: 'supabase',
		async provision(): Promise<void> {
			await ensurePgExporterPasswordSecret(
				ctx.projectName,
				ctx.repoSecrets,
			)
			await ensurePostgresPasswordSecret(
				ctx.repoSecrets,
				ctx.repository.owner,
				ctx.repository.name,
				ctx.environment,
			)
			await ensureJwtSecret(
				ctx.repoSecrets,
				ctx.repository.owner,
				ctx.repository.name,
				ctx.environment,
			)
		},
		async loadEnv(): Promise<ServiceEnv> {
			const value = ctx.repoSecrets[secretName]
			if (value === undefined || value === '') {
				throw new Error(
					`supabase service: GitHub org secret "${secretName}" must be defined — run "provision" first so the password is generated and persisted, then re-trigger the deploy workflow so ALL_SECRETS picks it up`,
				)
			}
			return {
				public: {},
				secret: { [POSTGRES_EXPORTER_PASSWORD_ENV]: value },
			}
		},
	}
}

export const supabaseServiceDefinition: ServiceDefinition<'supabase'> = {
	name: 'supabase',
	build(services, ctx) {
		if (services.supabase === undefined) return null
		return createSupabaseService(ctx)
	},
}
