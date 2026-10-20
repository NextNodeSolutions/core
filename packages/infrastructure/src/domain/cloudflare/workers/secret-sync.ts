// The Infisical environment is synced whole to a Worker: `wrangler deploy
// --secrets-file` sets every value with the version it uploads, and never
// deletes one. The names the Worker still holds that Infisical no longer has
// are deleted afterwards with `wrangler secret bulk`, as `null` values.
// Infisical stays the only source: a secret removed there leaves the Worker at
// the next deploy.
export function staleSecretNames(
	desired: Readonly<Record<string, string>>,
	existingNames: ReadonlyArray<string>,
): ReadonlyArray<string> {
	// Own keys only: `in` would also match inherited names such as
	// `constructor`, and keep a secret of that name on the Worker.
	return existingNames.filter(name => !Object.hasOwn(desired, name))
}

export function buildSecretDeletion(
	names: ReadonlyArray<string>,
): Record<string, null> {
	return Object.fromEntries(names.map(name => [name, null]))
}
