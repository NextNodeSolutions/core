import { writeSecretEnv, writeWarning } from '#/adapters/github/output.ts'
import { readAppEnvironment, requireGithubRepository } from '#/cli/env.ts'
import {
	BUILD_VAULT_PATH,
	VaultPathNotFoundError,
	projectVaultEnvironment,
} from '#/domain/vault/secret-vault.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { openProjectVault } from './open-vault.ts'

import type { SecretVault } from '#/domain/vault/secret-vault.ts'

const logger = createLogger()

// A project without a build folder in this environment builds with no value.
async function readBuildEnv(
	vault: SecretVault,
	folder: string,
): Promise<Record<string, string>> {
	try {
		return await vault.listSecrets()
	} catch (error) {
		if (!(error instanceof VaultPathNotFoundError)) throw error
		logger.info(`no ${folder} folder - the build runs without values`)
		return {}
	}
}

/**
 * Read the build folder of the repository's project for this environment and
 * export every value to the later steps of the build job, masked. Runs in
 * `build.yml` only, logged in as the build identity: it sees the repositories'
 * projects and never the CI project.
 */
export async function loadBuildEnvCommand(): Promise<void> {
	const environment = readAppEnvironment('PIPELINE_ENVIRONMENT')
	if (!environment)
		throw new Error('PIPELINE_ENVIRONMENT env var is required')

	const repoName = requireGithubRepository().name
	const lookup = await openProjectVault(
		repoName,
		environment,
		BUILD_VAULT_PATH,
	)
	if (lookup.kind === 'missing') {
		writeWarning(
			`no Infisical project named "${repoName}" is visible to the build identity (visible: ${lookup.visible.join(', ') || 'none'}) - the build runs without values. Add the identity to the project (README, "Secrets").`,
		)
		return
	}

	const folder = `${projectVaultEnvironment(environment)}${BUILD_VAULT_PATH}`
	const buildEnv = await readBuildEnv(lookup.vault, folder)
	for (const [name, buildValue] of Object.entries(buildEnv)) {
		writeSecretEnv(name, buildValue)
	}
	logger.info(
		`loaded ${Object.keys(buildEnv).length} build value(s) from project "${repoName}" ${folder}: ${Object.keys(buildEnv).join(', ')}`,
	)
}
