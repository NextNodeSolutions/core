import {
	getEnv,
	readJsonRecordEnv,
	requireGithubRepository,
} from '#/cli/env.ts'
import {
	POSTGRES_DATABASE_URL_SECRET,
	POSTGRES_PASSWORD_SECRET,
} from '#/cli/services/postgres/postgres.service.ts'
import { isHetznerDeployableConfig } from '#/config/types.ts'
import { resolveEnvironment } from '#/domain/environment.ts'
import {
	LEGACY_PLATFORM_SECRET_NAMES,
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

// Every name the pipeline may read from the project pool: the declared
// `[deploy].secrets` (global + per-service + generated), the postgres
// credentials, and the registry auth secret of upstream images.
function collectProjectSecretNames(
	config: DeployableConfig,
): ReadonlyArray<string> {
	const registrySecrets = isHetznerDeployableConfig(config)
		? Object.values(config.deploy.services).flatMap(service =>
				service.source === 'upstream' && service.registryAuthSecret
					? [service.registryAuthSecret]
					: [],
			)
		: []
	return [
		...config.deploy.secrets,
		POSTGRES_PASSWORD_SECRET,
		POSTGRES_DATABASE_URL_SECRET,
		...registrySecrets,
	]
}

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

/**
 * TRANSITIONAL - delete once every project has run it in each environment and
 * the GitHub secrets are removed (see MIGRATION.md).
 *
 * GitHub secret values are write-only: the only way to carry them over is from
 * inside a workflow run, where `toJSON(secrets)` exposes them. This copies into
 * the vault every secret the pipeline consumes that the vault does not hold
 * yet - the platform credentials, then what this project declares beyond them -
 * and never overwrites, so a value edited in the vault is not reverted by a
 * later run.
 */
export async function seedVaultCommand(
	config: DeployableConfig,
	vault: SecretVault = openVault(),
): Promise<void> {
	const environment = resolveEnvironment(
		config.project.type,
		getEnv('PIPELINE_ENVIRONMENT'),
	)
	const legacySecrets = readJsonRecordEnv('LEGACY_GITHUB_SECRETS')

	const platformSecrets = await vault.listSecrets(PLATFORM_SECRETS_PATH)
	const platformSeed = selectSeedSecrets(
		LEGACY_PLATFORM_SECRET_NAMES,
		legacySecrets,
		platformSecrets,
	)
	await seedFolder(vault, PLATFORM_SECRETS_PATH, platformSeed)

	// A declared name the platform folder already resolves (the monitoring app
	// reads the Cloudflare token) is not copied into the project folder: the
	// pool overlays both, and a copy would go stale at the next rotation.
	const projectPath = projectSecretsPath({
		repo: requireGithubRepository().name,
		environment,
	})
	const projectPool = buildProjectSecretPool(
		{ ...platformSecrets, ...platformSeed },
		await vault.listSecrets(projectPath),
	)
	await seedFolder(
		vault,
		projectPath,
		selectSeedSecrets(
			collectProjectSecretNames(config),
			legacySecrets,
			projectPool,
		),
	)
}
