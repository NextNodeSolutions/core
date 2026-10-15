// The `wrangler secret bulk` payload that makes a Worker hold exactly the
// project's secrets: every Infisical value set, and every name the Worker holds
// that Infisical no longer has mapped to `null`, which deletes it. Infisical
// stays the only source: a secret removed there leaves the Worker at the next
// deploy.
export function buildWorkerSecretSync(
	desired: Readonly<Record<string, string>>,
	existingNames: ReadonlyArray<string>,
): Record<string, string | null> {
	// Own keys only: `in` would also match inherited names such as
	// `constructor`, and keep a secret of that name on the Worker.
	const removed = existingNames.filter(name => !Object.hasOwn(desired, name))
	return {
		...desired,
		...Object.fromEntries(removed.map(name => [name, null])),
	}
}

export function removedSecretNames(
	payload: Readonly<Record<string, string | null>>,
): ReadonlyArray<string> {
	return Object.entries(payload)
		.filter(([, secretValue]) => secretValue === null)
		.map(([name]) => name)
}
