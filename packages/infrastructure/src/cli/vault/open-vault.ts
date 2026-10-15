import { requestGithubOidcToken } from '#/adapters/github/oidc-token.ts'
import {
	createInfisicalVault,
	listInfisicalProjects,
	loginInfisicalWithOidc,
} from '#/adapters/infisical/vault.ts'
import { requireEnv } from '#/cli/env.ts'
import {
	PLATFORM_VAULT_ENVIRONMENT,
	findProjectVault,
	projectVaultEnvironment,
} from '#/domain/vault/secret-vault.ts'

import type { AppEnvironment } from '#/domain/environment.ts'
import type { SecretVault } from '#/domain/vault/secret-vault.ts'

// Audience the GitHub OIDC token is minted for. The Infisical machine identity
// lists it in its allowed audiences, so a token minted for another relying
// party cannot be replayed against the vault.
const VAULT_OIDC_AUDIENCE = 'https://app.infisical.com'

async function login(): Promise<string> {
	const jwt = await requestGithubOidcToken(VAULT_OIDC_AUDIENCE)
	return loginInfisicalWithOidc(requireEnv('INFISICAL_IDENTITY_ID'), jwt)
}

let accessToken: Promise<string> | undefined

// One login per process: the CI project and the repository's project are read
// with the same short-lived token.
function loginOnce(): Promise<string> {
	accessToken ??= login()
	return accessToken
}

/**
 * The CI project, dedicated to the pipelines: no other identity is a member,
 * so no local or agent session can read it. Its id comes from the workflow
 * (organization Variable, an id, not a credential).
 */
export async function openPlatformVault(): Promise<SecretVault> {
	return createInfisicalVault(await loginOnce(), {
		projectId: requireEnv('INFISICAL_PROJECT_ID'),
		environment: PLATFORM_VAULT_ENVIRONMENT,
	})
}

export type ProjectVaultLookup =
	| { readonly kind: 'found'; readonly vault: SecretVault }
	// No project of that name among the ones the identity can see, listed so
	// the log tells a missing membership from a misnamed project.
	| { readonly kind: 'missing'; readonly visible: ReadonlyArray<string> }

/**
 * The repository's own project, found by name among the projects the identity
 * is a member of. Adding the identity to a repository's project is the whole
 * setup: nothing records the project id anywhere else.
 */
export async function openProjectVault(
	repoName: string,
	environment: AppEnvironment,
): Promise<ProjectVaultLookup> {
	const token = await loginOnce()
	const projects = await listInfisicalProjects(token)
	const project = findProjectVault(projects, repoName)
	if (!project) {
		return { kind: 'missing', visible: projects.map(({ name }) => name) }
	}
	return {
		kind: 'found',
		vault: createInfisicalVault(token, {
			projectId: project.id,
			environment: projectVaultEnvironment(environment),
		}),
	}
}
