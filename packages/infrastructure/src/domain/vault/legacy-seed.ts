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

// Declared names the pool resolves from the platform folder while the GitHub
// snapshot holds a different value and the project folder holds none. Such a
// value is either a repository or environment override, or a stale copy left
// behind by a rotation in the vault - the snapshot cannot tell them apart. The
// seed therefore never copies it (a stale copy would win in the pool) and
// reports the names, so a deliberate override is stored by hand.
export function findDivergentPlatformSecrets(
	names: ReadonlyArray<string>,
	legacySecrets: Readonly<Record<string, string>>,
	platformSecrets: Readonly<Record<string, string>>,
	projectSecrets: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
	return names.filter(name => {
		const legacyValue = legacySecrets[name]
		const platformValue = platformSecrets[name]
		if (!legacyValue || typeof platformValue === 'undefined') return false
		return !(name in projectSecrets) && legacyValue !== platformValue
	})
}
