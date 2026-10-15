import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * The secret vault is the single source of truth for every secret the pipeline
 * consumes - GitHub holds none. Two kinds of Infisical project hold them:
 *   - the CI project, root of environment `PLATFORM_VAULT_ENVIRONMENT`: the
 *     fleet-wide infra credentials (cloud providers, CI identities,
 *     registries) the workflows themselves consume;
 *   - one project per repository, named after it. The root of each environment
 *     holds the secrets its Workers receive, every one of them; its
 *     `BUILD_VAULT_PATH` folder holds the environment of its build. Nothing is
 *     declared in nextnode.toml.
 */
export const PLATFORM_VAULT_ENVIRONMENT = 'main'

export const VAULT_ROOT_PATH = '/'
export const BUILD_VAULT_PATH = '/build'

// No folder at the requested path. Infisical answers the same for an
// environment the project lacks.
export class VaultPathNotFoundError extends Error {}

// The environment slugs Infisical gives every new project (Development,
// Staging, Production), so a repository's project needs no renaming. Staging
// is left unused.
const PROJECT_VAULT_ENVIRONMENTS: Readonly<Record<AppEnvironment, string>> = {
	development: 'dev',
	production: 'prod',
}

export function projectVaultEnvironment(environment: AppEnvironment): string {
	return PROJECT_VAULT_ENVIRONMENTS[environment]
}

// An Infisical project the pipeline's identity can see.
export interface VaultProject {
	readonly id: string
	readonly name: string
}

/**
 * The repository's project among those the identity is a member of, keyed by
 * the GitHub repository name (not `project.name`): the runner sets it, so a
 * caller cannot point its pipeline at another repository's project from its
 * own nextnode.toml. Two visible projects with that name are ambiguous and
 * refused rather than picked at random.
 */
export function findProjectVault(
	projects: ReadonlyArray<VaultProject>,
	repoName: string,
): VaultProject | undefined {
	const matches = projects.filter(project => project.name === repoName)
	if (matches.length > 1) {
		throw new Error(
			`${matches.length} Infisical projects named "${repoName}" are visible to the pipeline identity - keep one`,
		)
	}
	return matches[0]
}

export interface SecretVault {
	// Every secret readable at the vault's path. Throws VaultPathNotFoundError
	// when no folder exists there.
	listSecrets(): Promise<Record<string, string>>
	// Create or replace each secret at the vault's path.
	setSecrets(secrets: Readonly<Record<string, string>>): Promise<void>
}
