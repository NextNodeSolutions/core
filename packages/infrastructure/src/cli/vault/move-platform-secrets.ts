import { movePlatformSecrets } from '#/adapters/infisical/move-platform-secrets.ts'
import { requireEnv } from '#/cli/env.ts'
import { PLATFORM_VAULT_ENVIRONMENT } from '#/domain/vault/secret-vault.ts'

import { login } from './open-vault.ts'

await movePlatformSecrets(
	await login(),
	requireEnv('INFISICAL_PROJECT_ID'),
	PLATFORM_VAULT_ENVIRONMENT,
)
