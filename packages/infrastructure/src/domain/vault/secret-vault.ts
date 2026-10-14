import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * The secret vault is the single source of truth for every secret the pipeline
 * consumes - GitHub holds none. Two folders frame it:
 *   - `PLATFORM_SECRETS_PATH`: the fleet-wide infra credentials (cloud
 *     providers, CI identities, registries) the workflows themselves consume.
 *     Read-only for the pipeline.
 *   - `projectSecretsPath()`: one folder per repository x environment, holding
 *     the secrets that belong to that project alone.
 */
export const PLATFORM_SECRETS_PATH = '/ci'
const PROJECT_SECRETS_ROOT = '/projects'

// Repository + pipeline environment a project secret is scoped to. Both are
// the values of the `repository` and `environment` claims of the job's OIDC
// token: the vault policy templates the folder it grants on those same claims,
// so the folder the code reads and the folder the token may read agree by
// construction - a pipeline cannot point itself at another project's folder.
export interface ProjectSecretScope {
	// `owner/name`, as GitHub sets it.
	readonly repository: string
	readonly environment: AppEnvironment
}

export function projectSecretsPath(scope: ProjectSecretScope): string {
	return `${PROJECT_SECRETS_ROOT}/${scope.repository}/${scope.environment}`
}

// The pool `[deploy].secrets` names resolve against (`ALL_SECRETS`): the
// platform secrets overlaid by the project's own, the project winning on a
// shared name. A project may therefore declare a platform secret without
// holding a copy that would go stale at the next rotation - the same semantics
// as `toJSON(secrets)`, which merged org, repo and environment secrets.
export function buildProjectSecretPool(
	platformSecrets: Readonly<Record<string, string>>,
	projectSecrets: Readonly<Record<string, string>>,
): Record<string, string> {
	return { ...platformSecrets, ...projectSecrets }
}

export interface SecretVault {
	// Every secret readable at `path`. A folder that does not exist holds none.
	listSecrets(path: string): Promise<Record<string, string>>
	// Create or replace each secret at `path`, creating the folder when absent.
	setSecrets(
		path: string,
		secrets: Readonly<Record<string, string>>,
	): Promise<void>
}
