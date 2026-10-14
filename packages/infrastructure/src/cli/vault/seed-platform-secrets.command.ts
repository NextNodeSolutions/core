// TRANSITIONAL - delete once the GitHub secrets are removed (see README.md,
// "Secrets").
//
// GitHub secret values are write-only: the only way to carry them over is from
// inside a workflow run, where `toJSON(secrets)` exposes them. This command
// copies the platform credentials into `/ci` once, from core's own Seed Vault
// workflow, and never overwrites, so a value edited in the vault is not
// reverted by a later run. The pipeline identity is read-only on `/ci`: the
// run needs a temporary write privilege, granted for the occasion.

import { readJsonRecordEnv } from '#/cli/env.ts'
import {
	LEGACY_PLATFORM_SECRET_NAMES,
	selectSeedSecrets,
} from '#/domain/vault/legacy-seed.ts'
import { PLATFORM_SECRETS_PATH } from '#/domain/vault/secret-vault.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { openVault } from './open-vault.ts'

import type { SecretVault } from '#/domain/vault/secret-vault.ts'

const logger = createLogger()

export async function seedPlatformSecretsCommand(
	vault: SecretVault = openVault(),
): Promise<void> {
	const platformSecrets = await vault.listSecrets(PLATFORM_SECRETS_PATH)
	const seedSecrets = selectSeedSecrets(
		LEGACY_PLATFORM_SECRET_NAMES,
		readJsonRecordEnv('LEGACY_GITHUB_SECRETS'),
		platformSecrets,
	)
	const seedNames = Object.keys(seedSecrets)
	if (!seedNames.length) {
		logger.info(`nothing to seed into ${PLATFORM_SECRETS_PATH}`)
		return
	}
	await vault.setSecrets(PLATFORM_SECRETS_PATH, seedSecrets)
	logger.info(
		`seeded ${seedNames.length} GitHub secret(s) into ${PLATFORM_SECRETS_PATH}: ${seedNames.join(', ')}`,
	)
}
