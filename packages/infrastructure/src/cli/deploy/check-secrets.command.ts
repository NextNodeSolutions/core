import { getEnv, readJsonRecordEnv } from '#/cli/env.ts'
import {
	collectRequiredSecrets,
	findMissingSecrets,
	formatMissingSecretsError,
} from '#/domain/deploy/required-secrets.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { DeployableConfig } from '#/config/types.ts'

const logger = createLogger()

/**
 * Fail the pipeline at its first stage when a secret declared in
 * `[deploy].secrets` was never set in GitHub - a fail-fast gate ahead of the
 * deploy-time `pickSecrets` presence check, so the run dies in seconds instead
 * of after quality, provision, build and migrate. Reports EVERY missing name at
 * once, and excludes generated secrets (absent until provision pushes them).
 */
export function checkSecretsCommand(config: DeployableConfig): void {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const required = collectRequiredSecrets(config.deploy)
	const missing = findMissingSecrets(
		required,
		readJsonRecordEnv('ALL_SECRETS'),
	)

	if (missing.length) {
		throw new Error(formatMissingSecretsError(missing, environment))
	}

	logger.info(
		`${required.length} declared secret(s) present for ${environment}`,
	)
}
