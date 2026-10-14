import { openVault } from '#/cli/vault/open-vault.ts'
import { generateSecretValue } from '#/domain/deploy/secret-generation.ts'
import { projectSecretsPath } from '#/domain/vault/secret-vault.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type {
	ProjectSecretScope,
	SecretVault,
} from '#/domain/vault/secret-vault.ts'

const logger = createLogger()

export const POSTGRES_PASSWORD_SECRET = 'POSTGRES_PASSWORD'

// 32 alphanumeric characters (~190 bits) - ample for a DB superuser credential.
const EMBEDDED_POSTGRES_PASSWORD_LENGTH = 32

/**
 * Auto-generate the embedded-postgres `POSTGRES_PASSWORD` on first provision
 * and store it in the project's vault folder, idempotent + non-rotating. The
 * value is drawn from the ALPHANUMERIC generator
 * on purpose: it is interpolated RAW (no escaping) into both the exporter
 * bootstrap SQL literal (`CREATE ROLE ... PASSWORD '<pw>'`) and the embedded
 * `DATABASE_URL` (`postgres://id:<pw>@host/db`). An alphanumeric alphabet
 * carries no `'`, `@`, `:`, `/`, `+` or `=`, so both render well-formed - which
 * a base64 secret (with `/`, `+`, `=`) would not. An operator-supplied password
 * already in `ALL_SECRETS` is left untouched: regenerating would orphan the
 * initialised database volume and break every live connection.
 *
 * The vault is read live by every job, so the migrate and deploy jobs that
 * follow provision in the same run already see the stored password.
 */
export async function ensureEmbeddedPostgresPasswordSecret(
	repoSecrets: Readonly<Record<string, string>>,
	scope: ProjectSecretScope,
	vault: SecretVault = openVault(),
): Promise<void> {
	if (repoSecrets[POSTGRES_PASSWORD_SECRET]) {
		logger.info(
			`embedded postgres ${POSTGRES_PASSWORD_SECRET} already in ALL_SECRETS - skipping (non-rotating)`,
		)
		return
	}
	const password = generateSecretValue({
		name: POSTGRES_PASSWORD_SECRET,
		generate: 'password',
		length: EMBEDDED_POSTGRES_PASSWORD_LENGTH,
	})
	const path = projectSecretsPath(scope)
	await vault.setSecrets(path, { [POSTGRES_PASSWORD_SECRET]: password })
	logger.info(
		`embedded postgres ${POSTGRES_PASSWORD_SECRET} generated + stored in the vault at ${path}`,
	)
}
