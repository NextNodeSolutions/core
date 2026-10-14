// TRANSITIONAL - delete with the `seed-vault` commands once the GitHub secrets
// are removed (see README.md, "Secrets").

// The org-level GitHub secrets the workflows consumed before the vault: the
// fleet-wide infra credentials, now read from `PLATFORM_SECRETS_PATH`. Names
// are kept identical on both sides so the workflows only change their source.
export const LEGACY_PLATFORM_SECRET_NAMES = [
	'CLOUDFLARE_API_TOKEN',
	'CLOUDFLARE_ACCOUNT_ID',
	'TF_CLOUD_TOKEN',
	'NPM_TOKEN',
	'NEXTNODE_APP_ID',
	'NEXTNODE_APP_PRIVATE_KEY',
	'PLANETSCALE_SERVICE_TOKEN_ID',
	'PLANETSCALE_SERVICE_TOKEN',
] as const

// The secrets to copy from the GitHub snapshot into one vault folder: wanted
// by name, set in GitHub, and not resolved by the vault yet. A secret the vault
// already resolves is never overwritten - from its first write the vault is
// the truth.
export function selectSeedSecrets(
	names: ReadonlyArray<string>,
	legacySecrets: Readonly<Record<string, string>>,
	vaultSecrets: Readonly<Record<string, string>>,
): Record<string, string> {
	return Object.fromEntries(
		names.flatMap((name): Array<[string, string]> => {
			const legacyValue = legacySecrets[name]
			if (!legacyValue || name in vaultSecrets) return []
			return [[name, legacyValue]]
		}),
	)
}

// The secrets to copy from the GitHub snapshot into a project folder: a
// declared name set in GitHub that the folder does not hold yet. A value equal
// to the platform one is skipped - the pool already resolves it, and a copy
// would go stale at the next rotation. A value that differs is a repository or
// environment override of a platform name, and is kept in the project folder so
// the pool still resolves to it.
export function selectProjectSeedSecrets(
	names: ReadonlyArray<string>,
	legacySecrets: Readonly<Record<string, string>>,
	platformSecrets: Readonly<Record<string, string>>,
	projectSecrets: Readonly<Record<string, string>>,
): Record<string, string> {
	return Object.fromEntries(
		names.flatMap((name): Array<[string, string]> => {
			const legacyValue = legacySecrets[name]
			const resolvedByVault =
				name in projectSecrets || platformSecrets[name] === legacyValue
			if (!legacyValue || resolvedByVault) return []
			return [[name, legacyValue]]
		}),
	)
}
