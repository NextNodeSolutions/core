import { createEnvSecretsAdapter } from '#/adapters/github/env-secrets.ts'
import { generateSecretValue } from '#/domain/deploy/secret-generation.ts'
import { createLogger } from '@nextnode-solutions/logger'

import type { EnvSecretsAdapter } from '#/adapters/github/env-secrets.ts'
import type { GeneratedSecretConfig } from '#/config/types.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

const logger = createLogger()

/**
 * Provision-time bootstrap for the project's auto-generated secrets. For each
 * `{ name, generate, length }` declared in `[deploy].secrets`, generate the
 * value once and push it as a GitHub env-secret on the project repo, scoped to
 * the current pipeline environment.
 *
 * Idempotent and non-rotating: a secret already present in `ALL_SECRETS` is left
 * untouched (regenerating a JWT/DB secret would invalidate every live token /
 * break the connection). The freshly-pushed value lands in a LATER run's
 * `ALL_SECRETS` snapshot — the same provision-then-redeploy contract the
 * supabase service uses. Fails loud when gh is unavailable but a push is needed.
 */
export async function ensureGeneratedSecrets(
	generated: ReadonlyArray<GeneratedSecretConfig>,
	repoSecrets: Readonly<Record<string, string>>,
	owner: string,
	repo: string,
	environment: AppEnvironment,
	adapter: EnvSecretsAdapter = createEnvSecretsAdapter(),
): Promise<void> {
	const pending = generated.filter(spec => !repoSecrets[spec.name])
	const present = generated.length - pending.length
	if (present > 0) {
		logger.info(
			`${present} generated secret(s) already present in ALL_SECRETS — skipping (no rotation)`,
		)
	}
	if (pending.length === 0) return

	if (!(await adapter.ghAvailable())) {
		throw new Error(
			`cannot generate secrets [${pending.map(spec => spec.name).join(', ')}] — gh CLI unavailable, so they cannot be pushed as GitHub env-secrets on ${owner}/${repo}`,
		)
	}

	for (const spec of pending) {
		const value = generateSecretValue(spec)
		await adapter.setRepoEnvSecret(
			spec.name,
			value,
			owner,
			repo,
			environment,
		)
		logger.info(
			`generated secret "${spec.name}" (${spec.generate}, length ${String(spec.length)}) pushed to ${owner}/${repo} (${environment})`,
		)
	}
}
