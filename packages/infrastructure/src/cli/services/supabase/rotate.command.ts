import type { DeployableConfig } from '#/config/types.ts'

import { rotatePgExporterPasswordSecret } from './supabase.service.ts'

/**
 * Force-rotate the project's postgres-exporter GitHub org secret with a
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
	await rotatePgExporterPasswordSecret(config.project.name)
}
