import { createEnvSecretsAdapter } from '#/adapters/github/env-secrets.ts'
import { generateSecretValue } from '#/domain/deploy/secret-generation.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type {
	EnvSecretsAdapter,
	RepoEnvScope,
} from '#/adapters/github/env-secrets.ts'

const logger = createLogger()

export const POSTGRES_PASSWORD_SECRET = 'POSTGRES_PASSWORD'

// 32 alphanumeric characters (~190 bits) - ample for a DB superuser credential.
const EMBEDDED_POSTGRES_PASSWORD_LENGTH = 32

/**
 * Auto-generate the embedded-postgres `POSTGRES_PASSWORD` on first provision
 * and push it as a GitHub env-secret, idempotent + non-rotating. The value is
 * drawn from the ALPHANUMERIC generator
 * on purpose: it is interpolated RAW (no escaping) into both the exporter
 * bootstrap SQL literal (`CREATE ROLE ... PASSWORD '<pw>'`) and the embedded
 * `DATABASE_URL` (`postgres://id:<pw>@host/db`). An alphanumeric alphabet
 * carries no `'`, `@`, `:`, `/`, `+` or `=`, so both render well-formed - which
 * a base64 secret (with `/`, `+`, `=`) would not. An operator-supplied password
 * already in `ALL_SECRETS` is left untouched: regenerating would orphan the
 * initialised database volume and break every live connection.
 *
 * Contract: a secret pushed here lands in a LATER run's `ALL_SECRETS` (GitHub
 * freezes secrets at job start), so the flow is provision -> re-trigger deploy,
 * the same contract used for every auto-generated secret.
 */
export async function ensureEmbeddedPostgresPasswordSecret(
	repoSecrets: Readonly<Record<string, string>>,
	scope: RepoEnvScope,
	adapter: EnvSecretsAdapter = createEnvSecretsAdapter(),
): Promise<void> {
	if (repoSecrets[POSTGRES_PASSWORD_SECRET]) {
		logger.info(
			`embedded postgres ${POSTGRES_PASSWORD_SECRET} already in ALL_SECRETS - skipping (non-rotating)`,
		)
		return
	}
	if (!(await adapter.ghAvailable())) {
		throw new Error(
			`postgres service (embedded mode): gh CLI unavailable - cannot persist "${POSTGRES_PASSWORD_SECRET}" as a GitHub env secret`,
		)
	}
	const password = generateSecretValue({
		name: POSTGRES_PASSWORD_SECRET,
		generate: 'password',
		length: EMBEDDED_POSTGRES_PASSWORD_LENGTH,
	})
	await adapter.setRepoEnvSecret(POSTGRES_PASSWORD_SECRET, password, scope)
	logger.info(
		`embedded postgres ${POSTGRES_PASSWORD_SECRET} generated + persisted as env-secret on ${scope.owner}/${scope.repo} (${scope.environment})`,
	)
}
