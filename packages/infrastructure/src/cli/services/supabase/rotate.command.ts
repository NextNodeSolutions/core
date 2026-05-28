import { getEnv, requireGithubRepository } from '#/cli/env.ts'
import { resolveEnvironment } from '#/domain/environment.ts'

import { rotatePgExporterPasswordSecret } from './supabase.service.ts'

import type { DeployableConfig } from '#/config/types.ts'

/**
 * Force-rotate the project's postgres-exporter GitHub env-secret with a
 * fresh 32-byte b64 value. Idempotent provision never rotates (would
 * split-brain the initdb-baked SQL role and the stored secret); this
 * command is the escape hatch. Operator runbook: `ALTER ROLE
 * postgres_exporter PASSWORD '<new>'` on the live db, then re-trigger
 * the deploy workflow so the refreshed `ALL_SECRETS` payload reaches
 * compose `.env`.
 */
export async function rotatePgExporterPasswordCommand(
	config: DeployableConfig,
): Promise<void> {
	const repository = requireGithubRepository()
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	await rotatePgExporterPasswordSecret(
		repository.owner,
		repository.name,
		environment,
	)
}
