import { openVault } from '#/cli/vault/open-vault.ts'
import { generateSecretValue } from '#/domain/deploy/secret-generation.ts'
import { projectSecretsPath } from '#/domain/vault/secret-vault.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { GeneratedSecretConfig } from '#/config/types.ts'
import type {
	ProjectSecretScope,
	SecretVault,
} from '#/domain/vault/secret-vault.ts'

const logger = createLogger()

/**
 * Provision-time bootstrap for the project's auto-generated secrets. For each
 * `{ name, generate, length }` declared in `[deploy].secrets`, generate the
 * value once and store it in the project's vault folder, scoped to the current
 * pipeline environment.
 *
 * Idempotent and non-rotating: a secret already present in `ALL_SECRETS` is left
 * untouched (regenerating a JWT/DB secret would invalidate every live token /
 * break the connection). The vault is read live by every job, so the jobs that
 * follow provision in the same run already see the freshly-stored value.
 */
export async function ensureGeneratedSecrets(
	generated: ReadonlyArray<GeneratedSecretConfig>,
	repoSecrets: Readonly<Record<string, string>>,
	scope: ProjectSecretScope,
	vault: SecretVault = openVault(),
): Promise<void> {
	const pending = generated.filter(spec => !repoSecrets[spec.name])
	const present = generated.length - pending.length
	if (present > 0) {
		logger.info(
			`${present} generated secret(s) already present in ALL_SECRETS - skipping (no rotation)`,
		)
	}
	if (!pending.length) return

	const path = projectSecretsPath(scope)
	await vault.setSecrets(
		path,
		Object.fromEntries(
			pending.map(spec => [spec.name, generateSecretValue(spec)]),
		),
	)
	for (const spec of pending) {
		logger.info(
			`generated secret "${spec.name}" (${spec.generate}, length ${String(spec.length)}) stored in the vault at ${path}`,
		)
	}
}
