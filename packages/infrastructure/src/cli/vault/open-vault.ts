import { requestGithubOidcToken } from '#/adapters/github/oidc-token.ts'
import {
	createInfisicalVault,
	loginInfisicalWithOidc,
} from '#/adapters/infisical/vault.ts'
import { requireEnv } from '#/cli/env.ts'

import type { InfisicalVaultLocation } from '#/adapters/infisical/vault.ts'
import type { SecretVault } from '#/domain/vault/secret-vault.ts'

// The NextNode vault: Infisical project "core-vault", environment "Main".
const VAULT_LOCATION: InfisicalVaultLocation = {
	projectId: 'ce69a081-6aec-472d-9ee8-edbb7ed2b72e',
	environment: 'main',
}

// Audience the GitHub OIDC token is minted for. The Infisical machine identity
// lists it in its allowed audiences, so a token minted for another relying
// party cannot be replayed against the vault.
const VAULT_OIDC_AUDIENCE = 'https://app.infisical.com'

async function connectVault(): Promise<SecretVault> {
	const identityId = requireEnv('INFISICAL_IDENTITY_ID')
	const jwt = await requestGithubOidcToken(VAULT_OIDC_AUDIENCE)
	const accessToken = await loginInfisicalWithOidc(identityId, jwt)
	return createInfisicalVault(accessToken, VAULT_LOCATION)
}

/**
 * Open the vault lazily: nothing is requested until the first read or write,
 * and one login then serves every call. A command that turns out to have
 * nothing to write (every generated secret already present) never logs in.
 */
export function openVault(): SecretVault {
	let connection: Promise<SecretVault> | undefined
	const connect = (): Promise<SecretVault> => {
		connection ??= connectVault()
		return connection
	}
	return {
		listSecrets: async path => {
			const vault = await connect()
			return vault.listSecrets(path)
		},
		setSecrets: async (path, secrets) => {
			const vault = await connect()
			return vault.setSecrets(path, secrets)
		},
	}
}
