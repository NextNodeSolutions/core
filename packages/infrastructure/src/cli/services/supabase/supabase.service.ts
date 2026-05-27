import { randomBytes } from 'node:crypto'

import { createOrgSecretsAdapter } from '#/adapters/github/org-secrets.ts'
import type { OrgSecretsAdapter } from '#/adapters/github/org-secrets.ts'
import { requireEnv } from '#/cli/env.ts'
import type {
	Service,
	ServiceDefinition,
	ServiceFactoryContext,
} from '#/cli/services/service.ts'
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

export function createSupabaseService(ctx: ServiceFactoryContext): Service {
	const secretName = pgExporterPasswordSecretName(ctx.projectName)
	return {
		name: 'supabase',
		async provision(): Promise<void> {
			await ensurePgExporterPasswordSecret(
				ctx.projectName,
				ctx.repoSecrets,
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
