// TRANSITIONAL - delete once the GitHub secrets are removed (see README.md,
// "Secrets").
//
// GitHub secret values are write-only: the only way to carry them over is from
// inside a workflow run, where `toJSON(secrets)` exposes them. This command
// copies the platform credentials into the CI project once, from core's own
// Seed Vault workflow, and never overwrites, so a value edited in the vault is
// not reverted by a later run.

import { readJsonRecordEnv } from '#/cli/env.ts'
import {
	LEGACY_PLATFORM_SECRET_NAMES,
	selectSeedSecrets,
} from '#/domain/vault/legacy-seed.ts'
import { createLogger } from '@nextnode-solutions/logger'

import { openPlatformVault } from './open-vault.ts'

import type { SecretVault } from '#/domain/vault/secret-vault.ts'

const logger = createLogger()

export async function seedPlatformSecretsCommand(
	vault?: SecretVault,
): Promise<void> {
	const platformVault = vault ?? (await openPlatformVault())
	const platformSecrets = await platformVault.listSecrets()
	const seedSecrets = selectSeedSecrets(
		LEGACY_PLATFORM_SECRET_NAMES,
		readJsonRecordEnv('LEGACY_GITHUB_SECRETS'),
		platformSecrets,
	)
	const seedNames = Object.keys(seedSecrets)
	if (!seedNames.length) {
		logger.info('nothing to seed into the CI project')
		return
	}
	await platformVault.setSecrets(seedSecrets)
	logger.info(
		`seeded ${seedNames.length} GitHub secret(s) into the CI project: ${seedNames.join(', ')}`,
	)
}
