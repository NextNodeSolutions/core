import {
	getEnv,
	readJsonRecordEnv,
	requireGithubRepository,
} from '#/cli/env.ts'
import {
	collectRequiredSecrets,
	findMissingSecrets,
	formatMissingSecretsError,
} from '#/domain/deploy/required-secrets.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import { projectSecretsPath } from '#/domain/vault/secret-vault.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { DeployableConfig } from '#/config/types.ts'

const logger = createLogger()

/**
 * Fail the pipeline at its first stage when a secret declared in
 * `[deploy].secrets` was never stored in the vault - the same check `pickSecrets`
 * runs inside `deploy`, hoisted so the run dies in seconds instead of after
 * quality, provision, build and migrate. Reports EVERY missing name at once.
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
		const vaultPath = projectSecretsPath({
			repo: requireGithubRepository().name,
			environment,
		})
		throw new Error(formatMissingSecretsError(missing, vaultPath))
	}

	logger.info(
		`${required.length} declared secret(s) present for ${environment}`,
	)
}
