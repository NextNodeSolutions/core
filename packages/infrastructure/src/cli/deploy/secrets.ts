export function pickSecrets(
	repoSecrets: Readonly<Record<string, string>>,
	names: ReadonlyArray<string>,
): Record<string, string> {
	const picked: Record<string, string> = {}

	for (const name of names) {
		const secretValue = repoSecrets[name]
		if (secretValue === undefined) {
			throw new Error(
				`Secret "${name}" declared in deploy.secrets but not found in GitHub Secrets`,
			)
		}
		picked[name] = secretValue
	}

	return picked
}
