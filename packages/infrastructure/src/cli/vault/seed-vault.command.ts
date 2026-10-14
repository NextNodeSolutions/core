// TRANSITIONAL - delete once the GitHub secrets are removed (see README.md,
// "Secrets").
//
// GitHub secret values are write-only: the only way to carry them over is from
// inside a workflow run, where `toJSON(secrets)` exposes them. These commands
// copy into the vault every secret the pipeline consumes that the vault does
// not hold yet, and never overwrite, so a value edited in the vault is not
// reverted by a later run.

import {
	getEnv,
	readJsonRecordEnv,
	requireGithubRepository,
} from '#/cli/env.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import {
	LEGACY_PLATFORM_SECRET_NAMES,
	findDivergentPlatformSecrets,
	selectSeedSecrets,
} from '#/domain/vault/legacy-seed.ts'
import {
	PLATFORM_SECRETS_PATH,
	buildProjectSecretPool,
	projectSecretsPath,
} from '#/domain/vault/secret-vault.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { openVault } from './open-vault.ts'

import type { DeployableConfig } from '#/config/types.ts'
import type { SecretVault } from '#/domain/vault/secret-vault.ts'

const logger = createLogger()

async function seedFolder(
	vault: SecretVault,
	path: string,
	seedSecrets: Readonly<Record<string, string>>,
): Promise<void> {
	const seedNames = Object.keys(seedSecrets)
	if (!seedNames.length) {
		logger.info(`nothing to seed into ${path}`)
		return
	}
	await vault.setSecrets(path, seedSecrets)
	logger.info(
		`seeded ${seedNames.length} GitHub secret(s) into ${path}: ${seedNames.join(', ')}`,
	)
}

// Copy the platform credentials the vault does not hold yet. Returns the
// platform folder as it stands after the copy, so a project seed can skip the
// names it already resolves.
async function seedPlatformSecrets(
	vault: SecretVault,
	legacySecrets: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
	const platformSecrets = await vault.listSecrets(PLATFORM_SECRETS_PATH)
	const platformSeed = selectSeedSecrets(
		LEGACY_PLATFORM_SECRET_NAMES,
		legacySecrets,
		platformSecrets,
	)
	await seedFolder(vault, PLATFORM_SECRETS_PATH, platformSeed)
	return { ...platformSecrets, ...platformSeed }
}

// Platform credentials only - for core's own Seed Vault workflow, which has no
// deployable project to seed.
export async function seedPlatformSecretsCommand(
	vault: SecretVault = openVault(),
): Promise<void> {
	await seedPlatformSecrets(vault, readJsonRecordEnv('LEGACY_GITHUB_SECRETS'))
}

// Platform credentials, then the secrets this project declares beyond them -
// run from the deploy pipeline of each consumer, once per environment.
export async function seedVaultCommand(
	config: DeployableConfig,
	vault: SecretVault = openVault(),
): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const legacySecrets = readJsonRecordEnv('LEGACY_GITHUB_SECRETS')
	const platformSecrets = await seedPlatformSecrets(vault, legacySecrets)

	const projectPath = projectSecretsPath({
		repo: requireGithubRepository().name,
		environment,
	})
	const projectSecrets = await vault.listSecrets(projectPath)

	const divergent = findDivergentPlatformSecrets(
		config.deploy.secrets,
		legacySecrets,
		platformSecrets,
		projectSecrets,
	)
	if (divergent.length) {
		logger.warn(
			`${divergent.join(', ')}: GitHub holds a different value than ${PLATFORM_SECRETS_PATH}, not copied - a stale copy if the vault was rotated, or a repository/environment override; store a deliberate override in ${projectPath}`,
		)
	}

	// A declared name the pool already resolves - from the platform folder or
	// the project's own - is never copied: a copy of a platform value would go
	// stale at the next rotation and still win in the pool.
	await seedFolder(
		vault,
		projectPath,
		selectSeedSecrets(
			config.deploy.secrets,
			legacySecrets,
			buildProjectSecretPool(platformSecrets, projectSecrets),
		),
	)
}
